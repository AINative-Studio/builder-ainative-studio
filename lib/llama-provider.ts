import { createOpenAI } from '@ai-sdk/openai'

export const llama = createOpenAI({
  apiKey: process.env.LLAMA_API_KEY!,
  baseURL: process.env.LLAMA_API_URL || 'https://api.llama.com/compat/v1',
})

export const llamaModel = llama(process.env.LLAMA_MODEL || 'Llama-4-Maverick-17B-128E-Instruct-FP8')