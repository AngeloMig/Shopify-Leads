# Stageshow kit

The React kit from the Stageshow skill (github.com/benjitaylor/skills,
`stageshow/kit`, commit `8020574`), MIT licensed (see `LICENSE`). It draws
the animated product shot on the sign-in page (`src/components/SignInDemo.tsx`).

Copied as is, except that the brand marks (`kit/brands/`, `BrandMark`) were
left out: Scout shows no other company's logos, and the artwork carries
third-party trademark terms. Their exports were removed from `kit/index.ts`,
`kit/parts/index.ts` and `kit/stageshow.css`.

Import parts from their own files (`kit/stage`, `kit/window`, `kit/motion/…`)
so the sign-in chunk only carries what it uses.
