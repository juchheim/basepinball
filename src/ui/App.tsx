import { useEffect, useRef, useState } from 'preact/hooks';
import { BRAND } from '../app/brand';
import type { GameStats } from '../rules/types';
import type { HighScore } from '../storage/highscores';
import {
  callout,
  finalStats,
  highScores,
  lastRank,
  pitchCue,
  qualified,
  screen,
  snapshot,
} from './store';

/** The DOM overlay: HUD, callouts and menus (docs/MVP/05 § 8). Basic M2 styling; art is M3. */

export interface UiActions {
  start: () => void;
  resume: () => void;
  quit: () => void;
  saveInitials: (initials: string) => void;
}

export function App({ actions }: { actions: UiActions }) {
  const s = screen.value;
  return (
    <div class="ui">
      {(s === 'playing' || s === 'paused') && <Hud />}
      {(s === 'playing' || s === 'paused') && <PitchIndicator paused={s === 'paused'} />}
      <CalloutView />
      {s === 'title' && <Title actions={actions} />}
      {s === 'paused' && <Pause actions={actions} />}
      {s === 'gameover' && <GameOver actions={actions} />}
      {s === 'scores' && <Scores actions={actions} />}
    </div>
  );
}

function Hud() {
  const g = snapshot.value;
  if (!g) return null;
  return (
    <div class="hud-bar">
      <div class="hud-cell">
        <span class="hud-label">INN</span>
        <span class="hud-value">{g.inning}</span>
      </div>
      <div class="hud-cell">
        <span class="hud-label">OUTS</span>
        <span class="outs">
          {[0, 1, 2].map((i) => (
            <i class={i < g.outs ? 'on' : ''} />
          ))}
        </span>
      </div>
      <Diamond bases={g.bases} />
      <div class="hud-cell">
        <span class="hud-label">R</span>
        <span class="hud-value">{g.stats.runs}</span>
      </div>
      <div class="hud-cell">
        <span class="hud-label">H</span>
        <span class="hud-value">{g.stats.hits}</span>
      </div>
      <div class="hud-chips">
        {g.hotBat && <span class="chip hot">HOT BAT</span>}
        {g.stealLit && <span class="chip steal">STEAL</span>}
        {g.rally >= 2 && <span class="chip rally">RALLY ×{g.rally}</span>}
        {g.tiltWarnings > 0 && !g.tilted && <span class="chip warn">WARNING {g.tiltWarnings}</span>}
        {g.state === 'LEADOFF_LAUNCH' && g.skillLane && (
          <span class="chip info">SKILL SHOT: {g.skillLane} LANE</span>
        )}
      </div>
    </div>
  );
}

const PITCH_NAMES = { FB: 'FASTBALL', CH: 'CHANGEUP', CB: 'CURVEBALL' } as const;

/**
 * The pre-pitch indicator, low on the screen near the flippers: the pitch type, an arrow to the
 * flipper it is thrown at, and a countdown bar that empties at the moment of release.
 */
function PitchIndicator({ paused }: { paused: boolean }) {
  const c = pitchCue.value;
  if (!c) return null;
  const left = c.side === 'L';
  return (
    <div
      class={`pitch-cue ${c.phase} ${left ? 'left' : 'right'} ${paused ? 'paused' : ''}`}
      key={c.id}
      style={{ '--lead': `${c.lead}s` }}
    >
      <div class="pitch-cue-row">
        <span class="pitch-cue-arrow">{left ? '◀' : ''}</span>
        <span class="pitch-cue-name">{c.phase === 'release' ? 'PITCH!' : PITCH_NAMES[c.type]}</span>
        <span class="pitch-cue-arrow">{left ? '' : '▶'}</span>
      </div>
      {c.phase === 'windup' && (
        <div class="pitch-cue-bar">
          <i />
        </div>
      )}
      {c.phase === 'windup' && <div class="pitch-cue-sub">{left ? 'left' : 'right'} flipper</div>}
    </div>
  );
}

function Diamond({ bases }: { bases: readonly boolean[] }) {
  // 2B at top, 3B left, 1B right.
  return (
    <svg class="diamond" viewBox="0 0 40 40" aria-label="bases">
      <rect
        x="16"
        y="2"
        width="9"
        height="9"
        transform="rotate(45 20.5 6.5)"
        class={bases[1] ? 'on' : ''}
      />
      <rect
        x="4"
        y="15"
        width="9"
        height="9"
        transform="rotate(45 8.5 19.5)"
        class={bases[2] ? 'on' : ''}
      />
      <rect
        x="28"
        y="15"
        width="9"
        height="9"
        transform="rotate(45 32.5 19.5)"
        class={bases[0] ? 'on' : ''}
      />
      <rect x="17" y="28" width="7" height="7" transform="rotate(45 20.5 31.5)" class="home" />
    </svg>
  );
}

function CalloutView() {
  const c = callout.value;
  if (!c) return null;
  return (
    <div class={`callout ${c.tone}`} key={c.id}>
      <div class="callout-text">{c.text}</div>
      {c.sub && <div class="callout-sub">{c.sub}</div>}
    </div>
  );
}

function Title({ actions }: { actions: UiActions }) {
  const scores = highScores.value;
  return (
    <div class="panel title" onPointerDown={actions.start}>
      <h1>{BRAND.game}</h1>
      <p class="tagline">Nine innings. Hit 'em where they ain't.</p>
      <p class="cta">Press Enter or tap to play</p>
      {scores.length > 0 && <ScoreTable scores={scores.slice(0, 5)} highlight={-1} />}
      <p class="controls">
        Flippers: Shift or ← → · Plunger: hold ↓ or Enter · Nudge: Z / Space · Sound: M
        <br />
        Touch: left / right half flips · hold the lower-right corner to plunge
      </p>
    </div>
  );
}

function Pause({ actions }: { actions: UiActions }) {
  return (
    <div class="panel pause">
      <h2>Paused</h2>
      <button onClick={actions.resume}>Resume</button>
      <button class="secondary" onClick={actions.quit}>
        Quit game
      </button>
    </div>
  );
}

function GameOver({ actions }: { actions: UiActions }) {
  const stats = finalStats.value;
  const [initials, setInitials] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  if (!stats) return null;
  const submit = (e: Event) => {
    e.preventDefault();
    actions.saveInitials(initials || '???');
  };
  return (
    <div class="panel gameover">
      <h2>Final</h2>
      <BoxScore stats={stats} />
      {qualified.value ? (
        <form onSubmit={submit} class="initials">
          <label>New high score! Your initials</label>
          <input
            ref={input}
            value={initials}
            maxLength={3}
            autoComplete="off"
            onInput={(e) =>
              setInitials(
                (e.target as HTMLInputElement).value.replace(/[^a-z]/gi, '').toUpperCase(),
              )
            }
          />
          <button type="submit">Save</button>
        </form>
      ) : (
        <button onClick={() => actions.saveInitials('')}>Continue</button>
      )}
    </div>
  );
}

function BoxScore({ stats }: { stats: GameStats }) {
  const innings = Array.from({ length: 9 }, (_, i) => stats.runsByInning[i] ?? 0);
  return (
    <div class="boxscore">
      <table>
        <thead>
          <tr>
            <th />
            {innings.map((_, i) => (
              <th>{i + 1}</th>
            ))}
            <th>R</th>
            <th>H</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="team">{BRAND.teamShort.toUpperCase()}</td>
            {innings.map((r) => (
              <td>{r}</td>
            ))}
            <td class="total">{stats.runs}</td>
            <td class="total">{stats.hits}</td>
          </tr>
        </tbody>
      </table>
      <div class="statline">
        <span>1B {stats.singles}</span>
        <span>2B {stats.doubles}</span>
        <span>3B {stats.triples}</span>
        <span>HR {stats.homeRuns}</span>
        <span>K {stats.strikeouts}</span>
        <span>LOB {stats.leftOnBase}</span>
        <span>Longest rally {stats.longestRally}</span>
        <span>SB {stats.steals}</span>
      </div>
    </div>
  );
}

function Scores({ actions }: { actions: UiActions }) {
  return (
    <div class="panel scores">
      <h2>High scores</h2>
      <ScoreTable scores={highScores.value} highlight={lastRank.value} />
      <button onClick={actions.start}>Play again</button>
    </div>
  );
}

function ScoreTable({ scores, highlight }: { scores: HighScore[]; highlight: number }) {
  if (scores.length === 0) return <p class="empty">No scores yet.</p>;
  return (
    <table class="scoretable">
      <tbody>
        {scores.map((s, i) => (
          <tr class={i === highlight ? 'mine' : ''}>
            <td>{i + 1}.</td>
            <td class="initials-cell">{s.initials}</td>
            <td>{s.runs} R</td>
            <td>{s.hits} H</td>
            <td>{s.hr} HR</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
