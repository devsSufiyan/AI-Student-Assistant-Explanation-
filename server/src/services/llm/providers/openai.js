/**
 * OpenAI-compatible LLM provider.
 *
 * Works with OpenAI, Groq, Together, vLLM, and Ollama's OpenAI-compatible
 * endpoint - anywhere that speaks `POST {baseUrl}/chat/completions`. That is why
 * we only configure a base URL rather than hard-coding a vendor.
 *
 * GROUNDING RULES (the reason this file takes a prompt-engineering stance):
 *   1. The model may ONLY use the supplied context.
 *   2. It must return citations as chunk ids.
 *   3. On any malformed output we throw, and the caller falls back to the
 *      extractive provider. A study tool must never silently serve a wrong
 *      answer, so "fail closed" is the policy.
 */

import { LLM } from '../../../config/constants.js';

/** Remove markdown code fences that models love to add around JSON. */
function stripFences(text) {
  return String(text)
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

/** Parse a JSON payload defensively; throw a clear error if it is not JSON. */
function parseJson(text) {
  try {
    return JSON.parse(stripFences(text));
  } catch {
    throw new Error(`LLM did not return valid JSON: ${String(text).slice(0, 200)}`);
  }
}

export function openaiProvider({ baseUrl, apiKey, model }) {
  /** Minimal wrapper around the chat-completions endpoint. */
  async function chat(messages) {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: LLM.TEMPERATURE,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      throw new Error(`LLM request failed (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  return {
    name: `openai:${model}`,

    async answerQuestion({ question, chunks }) {
      // Build a numbered context so the model has stable ids to cite.
      const context = chunks
        .map((c, i) => `[chunk ${i + 1} | id=${c.id}] ${c.text}`)
        .join('\n\n')
        .slice(0, LLM.MAX_CONTEXT_CHARS);

      const messages = [
        {
          role: 'system',
          content:
            'You are a study assistant. Answer ONLY using the provided context. ' +
            'If the context does not contain the answer, set "refused" to true and ' +
            'say you could not find it. Never use outside knowledge. Cite the chunk ' +
            'ids you used. Reply with JSON: {"answer": string, "refused": boolean, ' +
            '"usedChunkIds": string[]}.',
        },
        { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
      ];

      const raw = parseJson(await chat(messages));
      const usedIds = new Set(raw.usedChunkIds ?? []);
      const citations = chunks
        .filter((c) => usedIds.has(c.id))
        .map((c) => ({
          chunkId: c.id,
          materialId: c.materialId,
          page: c.page ?? null,
          quote: c.text.slice(0, 240),
          score: Number((c.score ?? 0).toFixed(4)),
        }));

      return {
        answer: String(raw.answer ?? '').trim(),
        citations,
        refused: Boolean(raw.refused),
        provider: this.name,
      };
    },

    async generateQuestions({ chunks, count, topicName }) {
      const context = chunks
        .map((c, i) => `[chunk ${i + 1} | id=${c.id}] ${c.text}`)
        .join('\n\n')
        .slice(0, LLM.MAX_CONTEXT_CHARS);

      const messages = [
        {
          role: 'system',
          content:
            'You write multiple-choice study questions. Base EVERY question strictly ' +
            'on the provided context. Each question has exactly 4 options and one ' +
            'correct answer. Reply with JSON: {"questions":[{"stem":string,' +
            '"options":[string,string,string,string],"correctIndex":number,' +
            '"difficulty":"easy"|"medium"|"hard","sourceChunkId":string,' +
            '"explanation":string}]}.',
        },
        {
          role: 'user',
          content: `Topic: ${topicName}\nWrite ${count} questions.\n\nContext:\n${context}`,
        },
      ];

      const raw = parseJson(await chat(messages));
      const list = Array.isArray(raw.questions) ? raw.questions : [];

      // Validate before anything reaches the database. A bad correctIndex would
      // corrupt grading and therefore every downstream mastery score.
      return list
        .filter(
          (q) =>
            typeof q.stem === 'string' &&
            Array.isArray(q.options) &&
            q.options.length === 4 &&
            Number.isInteger(q.correctIndex) &&
            q.correctIndex >= 0 &&
            q.correctIndex < 4,
        )
        .map((q) => ({
          stem: q.stem,
          options: q.options.map(String),
          correctIndex: q.correctIndex,
          difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
          sourceChunkId: typeof q.sourceChunkId === 'string' ? q.sourceChunkId : null,
          explanation: typeof q.explanation === 'string' ? q.explanation : '',
        }));
    },
  };
}
