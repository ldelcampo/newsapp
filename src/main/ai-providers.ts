import Anthropic from '@anthropic-ai/sdk'
import type { Link, ProviderId } from '../shared/factcheck'

export interface AskOptions {
  system: string
  prompt: string
  /** Let the provider search the web, when it can. */
  webSearch?: boolean
}

export interface Answer {
  text: string
  /** Pages the provider's own web search returned, the only outside links a verdict may cite. */
  searched: Link[]
}

/** One AI service. Every adapter takes a prompt and returns text that should hold a JSON object. */
export interface FactCheckProvider {
  ask(opts: AskOptions): Promise<Answer>
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

async function postJson(fetchFn: FetchFn, url: string, headers: Record<string, string>, body: unknown, what: string): Promise<unknown> {
  let res: Response
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) })
  } catch (e) {
    throw new Error((e as Error).name === 'TimeoutError' ? `${what} took too long to answer.` : `Could not reach ${what}. Check your connection${what === 'Ollama' ? ' and that Ollama is running' : ''}.`)
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) throw new Error(`${what} rejected the API key. Check it in Settings.`)
    if (res.status === 429) throw new Error(`${what} says the account is over its rate or spending limit.`)
    if (res.status === 404) throw new Error(`${what} does not know that model. Check the model name in Settings.`)
    throw new Error(`${what} answered HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
  }
  return res.json()
}

/** Models that accept the server-side refusal fallback. */
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/

export function claudeProvider(apiKey: string, model: string): FactCheckProvider {
  const client = new Anthropic({ apiKey, timeout: 300_000 })
  return {
    async ask({ system, prompt, webSearch }) {
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }]
      const searched: Link[] = []
      let text = ''
      try {
        // Web search runs on Anthropic's side; a long search can pause the turn, which we resume.
        for (let turn = 0; turn < 4; turn++) {
          const res = await client.beta.messages.create({
            model,
            max_tokens: 16000,
            system,
            messages,
            output_config: { effort: 'medium' },
            ...(webSearch ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }] } : {}),
            ...(FALLBACK_MODELS.test(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {})
          })
          for (const block of res.content) {
            if (block.type === 'text') text += block.text
            if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
              for (const r of block.content) if (r.type === 'web_search_result') searched.push({ title: r.title, url: r.url })
            }
          }
          if (res.stop_reason === 'refusal') throw new Error('Claude declined to check this story.')
          if (res.stop_reason !== 'pause_turn') break
          messages.push({ role: 'assistant', content: res.content })
          text = ''
        }
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new Error('Claude rejected the API key. Check it in Settings.')
        if (e instanceof Anthropic.RateLimitError) throw new Error('Claude says the account is over its rate or spending limit.')
        if (e instanceof Anthropic.NotFoundError) throw new Error('Claude does not know that model. Check the model name in Settings.')
        if (e instanceof Anthropic.APIConnectionError) throw new Error('Could not reach Claude. Check your connection.')
        if (e instanceof Anthropic.APIError) throw new Error(`Claude answered HTTP ${e.status}: ${e.message.slice(0, 200)}`)
        throw e
      }
      return { text, searched }
    }
  }
}

export function openAiProvider(apiKey: string, model: string, fetchFn: FetchFn = fetch): FactCheckProvider {
  return {
    async ask({ system, prompt }) {
      const j = (await postJson(
        fetchFn,
        'https://api.openai.com/v1/chat/completions',
        { authorization: `Bearer ${apiKey}` },
        { model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] },
        'OpenAI'
      )) as { choices?: { message?: { content?: string } }[] }
      return { text: j.choices?.[0]?.message?.content ?? '', searched: [] }
    }
  }
}

export function geminiProvider(apiKey: string, model: string, fetchFn: FetchFn = fetch): FactCheckProvider {
  return {
    async ask({ system, prompt }) {
      const j = (await postJson(
        fetchFn,
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { 'x-goog-api-key': apiKey },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        },
        'Gemini'
      )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
      return { text: (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''), searched: [] }
    }
  }
}

export function ollamaProvider(baseUrl: string, model: string, fetchFn: FetchFn = fetch): FactCheckProvider {
  return {
    async ask({ system, prompt }) {
      const j = (await postJson(
        fetchFn,
        `${baseUrl}/api/chat`,
        {},
        { model, stream: false, format: 'json', messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] },
        'Ollama'
      )) as { message?: { content?: string } }
      return { text: j.message?.content ?? '', searched: [] }
    }
  }
}

export function makeProvider(id: ProviderId, model: string, key: string | null, ollamaUrl: string): FactCheckProvider | null {
  if (id === 'ollama') return ollamaProvider(ollamaUrl, model)
  if (!key) return null
  if (id === 'claude') return claudeProvider(key, model)
  if (id === 'openai') return openAiProvider(key, model)
  return geminiProvider(key, model)
}
