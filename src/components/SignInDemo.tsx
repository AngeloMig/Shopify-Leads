import { useLayoutEffect, useRef, useState } from "react";
import { Stage } from "../stageshow/kit/stage";
import type { Act } from "../stageshow/kit/act";
import { Window, Bar } from "../stageshow/kit/window";
import { Collapse } from "../stageshow/kit/motion/Collapse";
import { Swap } from "../stageshow/kit/motion/Swap";
import { Spinner } from "../stageshow/kit/parts/Spinner";
import "../sign-in-demo.css";

// The sign-in page's product shot, built with the Stageshow kit
// (src/stageshow, from github.com/benjitaylor/skills). Scout's Leads list,
// in Scout's own tokens: a new store opens in at the top of the list while
// its audit runs, then lands as a Strong opportunity with its score. After a
// hold the row closes the way it opened and the scene resets while closed.
//
// Real strings: the list title, the new store, its finding and verdict, and
// the one row it arrives above. The rest is placeholder at real line heights.

type S = { open: boolean; done: boolean };

const initial: S = { open: false, done: false };
const poster: S = { open: true, done: true };

async function script(a: Act<S>) {
  await a.wait(900);
  a.mark("found");
  a.put({ open: true });
  await a.wait(2600);
  a.mark("scored");
  a.put({ done: true });
  await a.wait(2800);
  // What the loop added leaves in one motion; its verdict goes back where
  // nobody sees it
  a.put({ open: false });
  await a.wait(700);
  await a.snap({ done: false });
}

export default function SignInDemo() {
  return (
    <Stage<S>
      width={680}
      height={400}
      compact={{ below: 560, width: 440, height: 270 }}
      theme="dark"
      fill
      initial={initial}
      poster={poster}
      script={script}
      className="sid"
    >
      {(s, _rect, layout) => (
        <Window
          className="sid-win"
          title="Leads"
          toolbar={<Bar w={64} h={7} r={3.5} tone={2} />}
          sidebarWidth={132}
          sidebar={layout === "compact" ? undefined : <Side />}
          lights="grey"
        >
          <div className="sid-body">
            <div className="sid-list">
              <Collapse open={s.open} reveal="drop">
                <Lead
                  initial="H"
                  tone="sage"
                  name="Harbor & Pine"
                  domain="harborpine.example"
                  done={s.done}
                  lead
                />
              </Collapse>
              <Lead
                initial="N"
                tone="clay"
                name="Northline Living"
                domain="northline.example"
                done
              />
              {[132, 108, 146, 120, 98].map((w, i) => (
                <div key={i} className="sid-row sid-row--filler">
                  <Bar w={32} h={32} r={10} tone={1} />
                  {/* Each bar sits in the line box of the text it stands
                      for, so a placeholder row keeps a real row's pitch */}
                  <span className="sid-lines">
                    <span className="sid-name">
                      <Bar w={w} h={8} r={4} tone={2} />
                    </span>
                    <span className="sid-domain">
                      <Bar w={w - 40} h={7} r={3.5} tone={1} />
                    </span>
                  </span>
                  <span className="sid-lines">
                    <span className="sid-finding">
                      <Bar
                        w={[118, 96, 128, 104, 122][i]}
                        h={8}
                        r={4}
                        tone={2}
                      />
                    </span>
                    <span className="sid-verdict">
                      <Bar w={74} h={20} r={5} tone={1} />
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Window>
      )}
    </Stage>
  );
}

function Lead({
  initial,
  tone,
  name,
  domain,
  done,
  lead,
}: {
  initial: string;
  tone: "sage" | "clay";
  name: string;
  domain: string;
  done: boolean;
  lead?: boolean;
}) {
  return (
    <div className="sid-row" data-lead={lead || undefined}>
      <span className="sid-avatar" data-tone={tone}>
        {initial}
      </span>
      <span className="sid-lines">
        <span className="sid-name">{name}</span>
        <span className="sid-domain">{domain}</span>
      </span>
      <span className="sid-lines">
        {/* The finding takes the placeholder's place in one box, so the
            verdict line under it never moves */}
        <Swap id={done ? "found" : "pending"} className="sid-finding">
          {done ? (
            "Slow mobile loading"
          ) : (
            <span className="sid-finding">
              <Bar w={112} h={8} r={4} tone={2} />
            </span>
          )}
        </Swap>
        <span className="sid-verdict">
          <Verdict done={done} />
          <span className="sid-score" data-on={done || undefined}>
            {lead ? "86" : "92"}/100
          </span>
        </span>
      </span>
    </div>
  );
}

// One pill from Auditing to Strong: the tone eases, the spinner's cell closes
// as it fades, and the pill narrows to the shorter word from its right edge
// only. The old word has faded before the edge reaches it, so no letter is
// ever cut and there is never a second pill.
function Verdict({ done }: { done: boolean }) {
  const words = useRef<HTMLSpanElement[]>([]);
  const [w, setW] = useState<number[]>([]);
  useLayoutEffect(() => setW(words.current.map((e) => e.offsetWidth)), []);
  const on = done ? 1 : 0;
  return (
    <span className="sid-pill" data-done={done || undefined}>
      <span className="sid-mark">
        <Spinner size={10} />
      </span>
      <span
        className="sid-label"
        data-shrink={(w.length === 2 && w[on]! < w[1 - on]!) || undefined}
        style={w.length ? { width: w[on] } : undefined}
      >
        {["Auditing", "Strong"].map((t, i) => (
          <span
            key={t}
            ref={(e) => {
              if (e) words.current[i] = e;
            }}
            className="sid-word"
            data-on={i === on || undefined}
          >
            {t}
          </span>
        ))}
      </span>
    </span>
  );
}

function Side() {
  return (
    <nav className="sid-side">
      {[58, 76, 44, 66, 52].map((w, i) => (
        <span key={i} className="sid-nav" data-active={i === 2 || undefined}>
          <Bar w={12} h={12} r={3} tone={i === 2 ? 4 : 2} />
          <Bar w={w} h={6} tone={i === 2 ? 4 : 2} />
        </span>
      ))}
    </nav>
  );
}
