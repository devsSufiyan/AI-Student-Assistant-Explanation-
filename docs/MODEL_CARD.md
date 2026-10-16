# Model Card — Mastery & Adaptivity

This documents the two statistical models the app relies on, their parameters,
their intended use, and — importantly — their limitations. Include this
verbatim (or close to it) in any report.

---

## 1. Bayesian Knowledge Tracing (BKT) — the mastery model

**Question it answers:** what is the probability this student *knows* this topic
right now? One number per (student, topic), in `[0, 1]`.

**Parameters** (`server/src/config/constants.js` → `BKT`):

| Parameter | Default | Meaning |
|---|---|---|
| `pL0` | 0.10 | prior probability of already knowing the topic |
| `pLearn` | 0.15 | probability of learning after a correct answer |
| `pGuess` | 0.20 | P(correct \| does not know) — lucky guess |
| `pSlip` | 0.10 | P(incorrect \| knows) — careless slip |

**Update** after one graded answer:

```
posterior:
  correct: pL·(1−slip) / ( pL·(1−slip) + (1−pL)·guess )
  wrong:   pL·slip     / ( pL·slip     + (1−pL)·(1−guess) )

learning transition (applied ONLY on a correct answer):
  pL_new = posterior + (1 − posterior)·pLearn
```

**Difficulty weighting.** The move from prior to posterior is amplified in
log-odds space by `strength = 0.5 + (correct ? d : 1−d)`, where `d` is the item's
difficulty factor. So a *correct* answer on a *hard* question is strong evidence,
and a *wrong* answer on an *easy* question is strong counter-evidence.

**Documented deviation from textbook BKT.** Standard BKT applies `pLearn`
unconditionally. We apply it **only on correct answers**, because with a low
prior the unconditional transition makes a *wrong* answer *raise* mastery. Gating
it guarantees the two properties a mastery model must have: correct ⇒ mastery
rises, wrong ⇒ mastery falls. See `tests/bkt.test.js`.

**Limitations**

- Assumes a single latent skill per topic (no partial credit, no multi-skill items).
- Assumes topic independence; prerequisite structure is modelled separately, only
  for recommendations, not inside BKT.
- Saturates quickly under repeated correct answers — a student who answers four
  hard questions correctly is pushed toward ~1.0. Time decay is handled outside
  BKT via `forgettingRisk` and `spacingUrgency`, not by decaying the stored value.

---

## 2. Elo — the adaptivity model

**Questions it answers:** how strong is the student on this topic, and how hard
is this particular question?

**Parameters** (`ELO`): initial ability 1200; item seeds easy 1000 / medium 1200
/ hard 1400; `K_student = 24`, `K_item = 8`; target success `0.6`.

```
expected success: E = 1 / (1 + 10^((R_item − R_ability)/400))
ability update:   R_ability += K_student·(actual − E)
item update:      R_item    += K_item   ·(E − actual)     // note the sign flip
```

**Selection rule.** Serve the candidate question whose `E` is closest to `0.6` —
the zone of proximal development. Correct answers raise ability and therefore
raise the difficulty of the next question; wrong answers do the reverse.

**Limitations**

- Item ratings only become meaningful after several students answer them; early on
  they are just the author's label plus a little drift.
- The K-factors and the 400 scale are conventional, not tuned on real data here.

---

## 3. Recommendation scoring

See `PLAN.md` §7 and `server/src/modules/recommend/score.js`. It is an explicit
linear model with six terms, all weights configurable, and the full weighted
breakdown persisted per recommendation for auditing and ablation. The reason text
is templated from the breakdown; the LLM never produces or alters a score.

---

## 4. Evaluation

`npm run eval` (in `server/`) produces reproducible metrics:

- **RAG retrieval** — Recall@3 and MRR on a six-question golden set. The offline
  hashing embedder yields a *lower bound*; re-run with `EMBEDDING_PROVIDER=transformers`.
- **Recommendation ablation** — zero one weight at a time and observe how the
  ranking changes, showing which terms actually drive the advice.
- **Adaptive vs fixed** — across simulated students, adaptive keeps ~80% of
  questions in the productive 0.4–0.8 success band, versus ~6% for fixed order.
  Fixed order reaches mastery in fewer questions but using much easier questions
  (mean predicted success ~0.77), so its evidence is weaker.
