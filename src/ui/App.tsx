import { useEffect, useRef, useState } from 'preact/hooks';
import { BRAND } from '../app/brand';
import type { AiDifficulty, GameMode } from '../rules/match';
import type { GameSnapshot, GameStats } from '../rules/types';
import type { HighScore } from '../storage/highscores';
import { battingAverage } from '../storage/lifetime';
import {
  keyName,
  reducedMotion,
  REMAPPABLE,
  type QualitySetting,
  type RemappableAction,
  type Settings,
} from '../storage/settings';
import {
  activeAiDifficulty,
  activeGameMode,
  callout,
  finalStats,
  highScores,
  howToOpen,
  lastRank,
  lifetime,
  pitchCue,
  qualified,
  remapping,
  resumeCount,
  screen,
  settings,
  settingsNote,
  settingsOpen,
  snapshot,
} from './store';

/** The DOM overlay: HUD, callouts and menus (docs/MVP/05 § 8). Basic M2 styling; art is M3. */

export interface UiActions {
  start: (mode?: GameMode, difficulty?: AiDifficulty) => void;
  resume: () => void;
  quit: () => void;
  saveInitials: (initials: string) => void;
  pause: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  remap: (action: RemappableAction) => void;
  resetKeys: () => void;
}

export function App({ actions }: { actions: UiActions }) {
  const s = screen.value;
  const inGame = s === 'playing' || s === 'paused';
  const large = settings.value.hudScale === 'large';
  const calm = reducedMotion(settings.value);
  return (
    <div class={`ui ${large ? 'hud-large' : ''} ${calm ? 'reduced' : ''}`}>
      {inGame && <Hud />}
      {inGame && <LineScore />}
      {inGame && <PitchIndicator paused={s === 'paused'} />}
      {s === 'playing' && (
        <button class="pause-button" aria-label="Pause" onClick={actions.pause}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
            <rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
          </svg>
        </button>
      )}
      <CalloutView />
      {resumeCount.value !== null && (
        <div class="resume-count" key={resumeCount.value}>
          {resumeCount.value}
        </div>
      )}
      {s === 'title' && !settingsOpen.value && !howToOpen.value && <Title actions={actions} />}
      {s === 'paused' && !settingsOpen.value && !howToOpen.value && resumeCount.value === null && (
        <Pause actions={actions} />
      )}
      {s === 'gameover' && <GameOver actions={actions} />}
      {s === 'scores' && <Scores actions={actions} />}
      {settingsOpen.value && <SettingsPanel actions={actions} />}
      {howToOpen.value && <HowToPlay />}
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
        {g.stealReady && <span class="chip steal">STEAL: RIGHT RAMP</span>}
        {g.hustle > 0 && (
          <span
            class={`chip hustle ${g.hustle >= g.hustleTarget ? 'ready' : ''}`}
            aria-label={`Hustle ${g.hustle} of ${g.hustleTarget}`}
          >
            HUSTLE
            {[1, 2, 3, 4, 5].map((i) => (
              <i class={g.hustle >= (i * g.hustleTarget) / 5 ? 'on' : ''} />
            ))}
          </span>
        )}
        {g.walkHit.some(Boolean) && (
          <span class="chip walk" aria-label="W-A-L-K progress">
            {['W', 'A', 'L', 'K'].map((l, i) => (
              <b class={g.walkHit[i] ? 'on' : ''}>{l}</b>
            ))}
          </span>
        )}
        {g.throwBack && <span class="chip throwback">TWO BALLS</span>}
        {g.rally >= 2 && <span class="chip rally">RALLY ×{g.rally}</span>}
        {g.tiltWarnings > 0 && !g.tilted && <span class="chip warn">WARNING {g.tiltWarnings}</span>}
        {g.state === 'LEADOFF_LAUNCH' && g.skillLane && (
          <span class="chip info">SKILL SHOT: {g.skillLane} LANE</span>
        )}
        {g.vsAi && (
          <>
            <span class="chip opponent-score">
              {g.battingSide === 'ai' ? 'TOP' : 'BOTTOM'} {g.inning} ·{' '}
              {g.battingSide === 'ai' ? 'AI PLAYING' : 'YOUR TURN'}
            </span>
            <span class="chip opponent-score">
              YOU {g.humanStats?.runs ?? 0} · AI {g.aiStats?.runs ?? 0} ·{' '}
              {activeAiDifficulty.value.toUpperCase()}
            </span>
          </>
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

/** Landscape only (CSS): the full line score, 1-9, R and H, as on the ballpark board. */
function LineScore() {
  const g: GameSnapshot | null = snapshot.value;
  if (!g) return null;
  const vsAi = g.vsAi ?? activeGameMode.value === 'vs-ai';
  const human = g.humanStats ?? g.stats;
  const ai = g.aiStats;
  const aiActive = g.battingSide === 'ai';
  return (
    <div class="linescore">
      <table>
        <thead>
          <tr>
            <th />
            {Array.from({ length: 9 }, (_, i) => (
              <th class={i + 1 === g.inning ? 'now' : ''}>{i + 1}</th>
            ))}
            <th>R</th>
            <th>H</th>
          </tr>
        </thead>
        <tbody>
          {vsAi && ai && (
            <tr>
              <th scope="row" class="team">
                AI · {activeAiDifficulty.value.toUpperCase()}
              </th>
              {Array.from({ length: 9 }, (_, i) => (
                <td class={aiActive && i + 1 === g.inning ? 'now' : ''}>
                  {ai.runsByInning[i] ?? ''}
                </td>
              ))}
              <td class="total">{ai.runs}</td>
              <td class="total">{ai.hits}</td>
            </tr>
          )}
          <tr>
            <th scope="row" class="team">
              {vsAi ? BRAND.teamShort.toUpperCase() : ''}
            </th>
            {Array.from({ length: 9 }, (_, i) => (
              <td class={!aiActive && i + 1 === g.inning ? 'now' : ''}>
                {human.runsByInning[i] ?? ''}
              </td>
            ))}
            <td class="total">{human.runs}</td>
            <td class="total">{human.hits}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Lifetime() {
  const l = lifetime.value;
  if (l.games === 0) return null;
  return (
    <p class="lifetime">
      {l.games} game{l.games === 1 ? '' : 's'} · best {l.bestRuns} R · {l.homeRuns} HR · AVG{' '}
      {battingAverage(l)} · longest rally {l.longestRally}
    </p>
  );
}

/** One illustrated screen: the idea, the shots, the outs, the features, the controls. */
function HowToPlay() {
  const close = () => {
    howToOpen.value = false;
    if (location.hash === '#how-to-play')
      history.replaceState(null, '', location.pathname + location.search);
  };
  return (
    <div class="panel howto" onPointerDown={(e) => e.stopPropagation()}>
      <h2>How to play</h2>
      <p class="lead">
        Real pinball, scored like baseball. You bat for nine innings; three outs end each one. Score
        as many runs as you can.
      </p>
      <p>
        Choose <b>Single Player</b> for the solo challenge, or <b>Multiplayer vs AI</b> to play
        against an opponent with Easy, Medium or Hard skill. The AI plays the pinball table at the
        top of each inning; you play the bottom half and bat last.
      </p>
      <h3>Hits</h3>
      <table class="shots">
        <tbody>
          <tr>
            <td>
              <span class="cap c1">1B</span>
              <span class="cap c2">2B</span>
            </td>
            <td>
              Up the middle into <b>the Gap</b>: the pop bumpers are singles (front) and doubles
              (back).
            </td>
          </tr>
          <tr>
            <td>
              <span class="cap c3">3B</span>
            </td>
            <td>
              A clean <b>orbit</b> shot off the bat, round into the corner kicker.
            </td>
          </tr>
          <tr>
            <td>
              <span class="cap c4">HR</span>
            </td>
            <td>
              The left ramp, <b>Over the Wall</b>.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Runners advance by the hit: a double moves everyone up two bases. After a hit the ball stays
        live: flip it again for a <b>rally</b>.
      </p>
      <h3>Outs</h3>
      <p>
        A ball that settles in a <b>fielder's glove</b> (the seven saucers) is caught for an out,
        even after a hit. <b>Every drain is an out</b>: down the middle is a strikeout, off an
        outlane a foul out.
      </p>
      <h3>Pitching</h3>
      <p>
        Each at-bat starts with a pitch from the mound. The panel shows the pitch and the flipper
        it's coming to, and counts down to the release: flip to hit it back up the field.
      </p>
      <h3>Features</h3>
      <ul>
        <li>
          <b>B-A-T</b> drop targets: <b>Hot Bat</b>, your next hit goes one base further.
        </li>
        <li>
          <b>The right ramp</b> steals: with a runner on, the lead runner takes the next base (a
          runner on third steals home). Spell <b>W-A-L-K</b> on the four targets at the lower right
          and the batter takes a <b>walk</b>: first base, forcing any runners ahead of him. Letters
          you've hit glow on the table and in the HUD, and stay lit until the word is spelled.
        </li>
        <li>
          <b>Bumpers matter</b>: once the ball is in play, every bumper hit that isn't itself a hit
          (the two <b>outfield bumpers</b>, the Gap after a hit, or the <b>Stretch</b>) fills the{' '}
          <b>HUSTLE</b> meter. Full, with a runner on, every runner takes an extra base.
        </li>
        <li>
          <b>Pitching from the Stretch</b>: with a runner on base the pitcher goes to the stretch
          and a disc rises on the mound. Its front and sides are a ramp, so a shot from a flipper
          rides up it and flies off the back; its back is a bumper that kicks a ball coming down the
          table. It sinks again when the bases are empty.
        </li>
        <li>
          <b>R-B-I</b> top lanes: relight the <b>kickback</b> that saves a left outlane drain.
        </li>
        <li>
          Each inning's first ball is plunged: roll through the lit top lane for a <b>skill shot</b>
          . Or plunge hard, round the whole arch and down the left orbit through its spinners, for a{' '}
          <b>spin bonus</b>: it lights a dot on the HUSTLE meter.
        </li>
      </ul>
      <h3>Controls</h3>
      <table class="controls-table">
        <tbody>
          <tr>
            <td>Keyboard</td>
            <td>
              Flippers Shift or ← →; plunger ↓ or Enter (hold, let go); nudge Z, /, Space; pause
              Esc; sound M
            </td>
          </tr>
          <tr>
            <td>Touch</td>
            <td>
              Left / right half of the screen flips; drag the plunger knob (lower right) down and
              let go; flick near the top to nudge
            </td>
          </tr>
          <tr>
            <td>Gamepad</td>
            <td>
              Bumpers or triggers flip; A or the right stick plunges; flick the left stick to nudge;
              Start pauses
            </td>
          </tr>
        </tbody>
      </table>
      <p class="tip">
        Nudge too hard and you'll get a warning; a third is a <b>tilt</b> and an out.
      </p>
      <button onClick={close}>Got it</button>
    </div>
  );
}

const QUALITY: { value: QualitySetting; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'ultra', label: 'Ultra' },
];

function SettingsPanel({ actions }: { actions: UiActions }) {
  const st = settings.value;
  const vol = (key: keyof Settings['volume'], label: string) => (
    <label class="row">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(st.volume[key] * 100)}
        onInput={(e) =>
          actions.updateSettings({
            volume: { ...st.volume, [key]: Number((e.target as HTMLInputElement).value) / 100 },
          })
        }
      />
    </label>
  );
  const choice = <T extends string>(
    label: string,
    value: T,
    options: { value: T; label: string }[],
    set: (v: T) => void,
  ) => (
    <div class="row">
      <span>{label}</span>
      <div class="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            role="radio"
            aria-checked={o.value === value}
            class={o.value === value ? 'on' : ''}
            onClick={() => set(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
  const toggle = (label: string, value: boolean, set: (v: boolean) => void) =>
    choice(
      label,
      value ? 'on' : 'off',
      [
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' },
      ],
      (v) => set(v === 'on'),
    );
  return (
    <div class="panel settings" onPointerDown={(e) => e.stopPropagation()}>
      <h2>Settings</h2>
      <h3>Sound</h3>
      {vol('master', 'Master')}
      {vol('sfx', 'Machine')}
      {vol('crowd', 'Crowd')}
      {vol('music', 'Organ')}
      {toggle('Mute (M)', st.muted, (muted) => actions.updateSettings({ muted }))}
      <h3>Display</h3>
      {choice('Quality', st.quality, QUALITY, (quality) => actions.updateSettings({ quality }))}
      {choice(
        'Frame rate',
        st.frameRate,
        [
          { value: 'auto', label: 'Auto' },
          { value: '60', label: '60 (battery)' },
          { value: 'max', label: 'Max' },
        ],
        (frameRate) => actions.updateSettings({ frameRate }),
      )}
      {toggle('Battery saver', st.batterySaver, (batterySaver) =>
        actions.updateSettings({ batterySaver }),
      )}
      {choice(
        'Graphics',
        st.graphics,
        [
          { value: 'auto', label: 'Auto' },
          { value: 'compat', label: 'Compatibility' },
        ],
        (graphics) => {
          actions.updateSettings({ graphics });
          settingsNote.value = 'Reload the page to apply the graphics change.';
        },
      )}
      {choice(
        'HUD size',
        st.hudScale,
        [
          { value: 'normal', label: 'Normal' },
          { value: 'large', label: 'Large' },
        ],
        (hudScale) => actions.updateSettings({ hudScale }),
      )}
      {choice(
        'Reduced motion',
        st.reducedMotion,
        [
          { value: 'system', label: 'System' },
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ],
        (reducedMotion) => actions.updateSettings({ reducedMotion }),
      )}
      <h3>Controls</h3>
      {toggle('Vibration', st.haptics, (haptics) => actions.updateSettings({ haptics }))}
      {toggle('Shake phone to nudge', st.motionNudge, (motionNudge) =>
        actions.updateSettings({ motionNudge }),
      )}
      {settingsNote.value && <p class="note">{settingsNote.value}</p>}
      <table class="keys">
        <tbody>
          {REMAPPABLE.map(({ action, label }) => (
            <tr>
              <td>{label}</td>
              <td>
                <button class="key" onClick={() => actions.remap(action)}>
                  {remapping.value === action
                    ? 'Press a key… (Esc cancels)'
                    : st.keys[action].map(keyName).join(' · ')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="buttons">
        <button class="secondary" onClick={actions.resetKeys}>
          Reset keys
        </button>
        <button onClick={actions.closeSettings}>Done</button>
      </div>
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
  const [menuStep, setMenuStep] = useState<'mode' | 'difficulty'>('mode');
  return (
    <div class="panel title">
      <p class="kicker">
        {BRAND.park} · {BRAND.team}
      </p>
      <h1 class="logo">
        <img src="/steel-diamond.webp" alt={BRAND.game} width={585} height={613} />
      </h1>
      <p class="tagline">Nine innings. Hit 'em where they ain't.</p>
      {menuStep === 'mode' ? (
        <>
          <p class="cta">Choose a game mode</p>
          <div class="mode-choices">
            <button onClick={() => actions.start('single')}>Single Player</button>
            <button class="secondary" onClick={() => setMenuStep('difficulty')}>
              Multiplayer vs AI
            </button>
          </div>
          <p class="menu-hint">Press Enter for Single Player</p>
        </>
      ) : (
        <div class="difficulty-choice">
          <h2>Choose AI difficulty</h2>
          <p>The AI plays the table in the top half. You play the bottom half and bat last.</p>
          <div class="difficulty-buttons">
            {(['easy', 'medium', 'hard'] as const).map((difficulty) => (
              <button onClick={() => actions.start('vs-ai', difficulty)}>
                {difficulty[0]!.toUpperCase() + difficulty.slice(1)}
              </button>
            ))}
          </div>
          <button class="secondary small" onClick={() => setMenuStep('mode')}>
            Back to game modes
          </button>
        </div>
      )}
      {scores.length > 0 && <ScoreTable scores={scores.slice(0, 5)} highlight={-1} />}
      <Lifetime />
      <p class="controls">
        Flippers: Shift or ← → · Plunger: hold ↓ or Enter · Nudge: Z / Space · Sound: M
        <br />
        Touch: left / right half flips · drag the plunger knob (lower right) down and let go · flick
        near the top to nudge · Gamepad: bumpers flip, A plunges
      </p>
      <div class="title-buttons">
        <button
          class="secondary small"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            howToOpen.value = true;
          }}
        >
          How to play
        </button>
        <button
          class="secondary small"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            actions.openSettings();
          }}
        >
          Settings
        </button>
      </div>
      <p class="version">v{__APP_VERSION__}</p>
    </div>
  );
}

function Pause({ actions }: { actions: UiActions }) {
  return (
    <div class="panel pause">
      <h2>Paused</h2>
      <button onClick={actions.resume}>Resume</button>
      <button class="secondary" onClick={() => (howToOpen.value = true)}>
        How to play
      </button>
      <button class="secondary" onClick={actions.openSettings}>
        Settings
      </button>
      <button class="secondary" onClick={actions.quit}>
        Quit game
      </button>
    </div>
  );
}

function GameOver({ actions }: { actions: UiActions }) {
  const stats = finalStats.value;
  const vsAi = activeGameMode.value === 'vs-ai';
  const opponent = vsAi ? (snapshot.value?.aiStats ?? null) : null;
  const [initials, setInitials] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  if (!stats) return null;
  const submit = (e: Event) => {
    e.preventDefault();
    actions.saveInitials(initials || '???');
  };
  const result =
    !vsAi || !opponent
      ? 'FINAL'
      : stats.runs === opponent.runs
        ? 'TIE GAME'
        : stats.runs > opponent.runs
          ? 'YOU WIN'
          : 'AI WINS';
  return (
    <div class="panel gameover">
      <h2>{result}</h2>
      <BoxScore stats={stats} opponent={vsAi ? opponent : null} />
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

function BoxScore({ stats, opponent }: { stats: GameStats; opponent: GameStats | null }) {
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
          {opponent && (
            <tr>
              <td class="team">AI · {activeAiDifficulty.value.toUpperCase()}</td>
              {Array.from({ length: 9 }, (_, i) => (
                <td>{opponent.runsByInning[i] ?? ''}</td>
              ))}
              <td class="total">{opponent.runs}</td>
              <td class="total">{opponent.hits}</td>
            </tr>
          )}
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
        <span>BB {stats.walks}</span>
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
      <Lifetime />
      <button onClick={() => actions.start(activeGameMode.value, activeAiDifficulty.value)}>
        Play again
      </button>
      <button class="secondary" onClick={actions.quit}>
        Choose game mode
      </button>
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
