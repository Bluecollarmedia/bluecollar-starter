// Run: node scripts/checks/ourWorkStories.check.cjs <path to typescript package>
// Stories on Our Work: the rules (24 hours, the ring, tapping through, the shared card's design) and the database part (update 115).
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const compile = (src) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, () => ({}));
  return m.exports;
};
const S = compile(read('src/lib/portfolioStories.ts'));
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

const NOW = Date.parse('2026-10-28T12:00:00Z');
const st = (id, createdH, o = {}) => ({ id, kind: 'photo', media_url: 'u', media_thumb_url: null, duration_s: null, post_id: null, media_id: null, design: null, created_at: new Date(NOW + createdH * 3_600_000).toISOString(), expires_at: new Date(NOW + (createdH + 24) * 3_600_000).toISOString(), ...o });

check('1 a story lasts 24 hours', S.STORY_HOURS === 24 && S.expiresAtFor(NOW) === '2026-10-29T12:00:00.000Z');
const list = [st('b', -3), st('old', -25), st('a', -10)];
check('2 only stories still inside their 24 hours show, oldest first (the order they play)', S.activeStories(list, NOW).map((s) => s.id).join() === 'a,b', S.activeStories(list, NOW).map((s) => s.id).join());
check('3 no stories at all (an old saved feed has none) is just an empty list', S.activeStories(undefined, NOW).length === 0);
check('4 the owner sees how long a story has left, and nothing once it is over', S.timeLeftLabel(new Date(NOW + 18 * 3_600_000).toISOString(), NOW) === '18h left' && S.timeLeftLabel(new Date(NOW + 35 * 60_000).toISOString(), NOW) === '35m left' && S.timeLeftLabel(new Date(NOW - 1000).toISOString(), NOW) === '');
check('5 a photo and a shared card stay a few seconds; a video plays its own length (never more than 60 seconds)', S.storyDurationMs({ kind: 'photo' }) === 5000 && S.storyDurationMs({ kind: 'share' }) === 6000 && S.storyDurationMs({ kind: 'video', duration_s: 24 }) === 24000 && S.storyDurationMs({ kind: 'video', duration_s: 300 }) === 60000);

check('6 tapping the left third goes back, anywhere else goes on', S.tapZone(50, 400) === 'previous' && S.tapZone(119, 400) === 'previous' && S.tapZone(120, 400) === 'next' && S.tapZone(390, 400) === 'next');
check('7 after the last story the viewer closes; going back from the first restarts it', S.nextIndex(0, 3) === 1 && S.nextIndex(2, 3) === null && S.previousIndex(0) === 0 && S.previousIndex(2) === 1);

const three = [st('a', -3), st('b', -2), st('c', -1)];
check('8 no stories: no ring; something unwatched: a coloured ring; everything watched: a grey ring', S.ringState([], new Set()) === 'none' && S.ringState(three, new Set(['a'])) === 'unseen' && S.ringState(three, new Set(['a', 'b', 'c'])) === 'seen');
check('9 opening starts at the first story not watched yet, and from the start when all were watched', S.startIndex(three, new Set(['a'])) === 1 && S.startIndex(three, new Set(['a', 'b', 'c'])) === 0 && S.startIndex(three, new Set()) === 0);
check('10 the watched list never repeats an id and drops stories that no longer exist', S.markSeen(['a', 'gone'], 'b', ['a', 'b', 'c']).join() === 'a,b' && S.markSeen(['a', 'b'], 'a', ['a', 'b']).join() === 'b,a');

const d = S.normalizeDesign({ frameWidth: 99, radius: -4, scale: 5, color: 'red', text: 'x'.repeat(200), textPlace: 'middle', background: 'plaid' });
check('11 a card design is always safe to draw: sizes stay inside their limits, bad colours and unknown choices fall back', d.frameWidth === 24 && d.radius === 0 && d.scale === 0.95 && d.color === S.DEFAULT_DESIGN.color && d.text.length === 80 && d.textPlace === 'bottom' && d.background === 'gradient');
check('12 nothing stored at all still gives the default card', JSON.stringify(S.normalizeDesign(null)) === JSON.stringify(S.DEFAULT_DESIGN));
check('13 the + and - buttons stay inside the limits', S.stepValue(22, 4, 0, 24) === 24 && S.stepValue(2, -4, 0, 24) === 0 && S.stepValue(0.78, 0.05, 0.5, 0.95) === 0.83);

check('14 a photo or video story needs its file; a video is at most 60 seconds; a share needs a post', !!S.storyProblem({ kind: 'photo' }) && S.storyProblem({ kind: 'photo', mediaUrl: 'x' }) === null && !!S.storyProblem({ kind: 'video', mediaUrl: 'x', durationS: 61 }) && S.storyProblem({ kind: 'video', mediaUrl: 'x', durationS: 30 }) === null && !!S.storyProblem({ kind: 'share' }) && S.storyProblem({ kind: 'share', postId: 'p' }) === null);
const vpost = { kind: 'video', media: [{ id: 'v1', kind: 'video' }] };
const ppost = { kind: 'post', media: [{ id: 'p1', kind: 'photo' }, { id: 'v2', kind: 'video' }] };
check('15 tapping a shared card opens the reel for a video post, the chosen video when one was chosen, and the project otherwise', JSON.stringify(S.shareTarget({ post_id: 'a', media_id: null }, vpost)) === JSON.stringify({ type: 'video', postId: 'a', mediaId: 'v1' }) && S.shareTarget({ post_id: 'a', media_id: 'v2' }, ppost).mediaId === 'v2' && S.shareTarget({ post_id: 'a', media_id: null }, { kind: 'post', media: [{ id: 'p1', kind: 'photo' }] }).type === 'post' && S.shareTarget({ post_id: 'a', media_id: null }, undefined) === null);

const sql = read('supabase/updates/115_our_work.sql');
check('16 stories are in the unrun database file: 24-hour expiry, owner/admin only, and the public feed carries only live stories', /create table if not exists public\.portfolio_stories/.test(sql) && /interval '24 hours'/.test(sql) && /portfolio_stories_manage/.test(sql) && /st\.expires_at > now\(\)/.test(sql) && /'stories', sts/.test(sql));
check('17 a shared card shows publicly only while its post is visible', /st\.kind <> 'share' or exists \(select 1 from public\.portfolio_posts pp where pp\.id = st\.post_id and pp\.visible\)/.test(sql));
// ── the viewer and the ring (step 2) ──
const viewer = read('app/weather/work-story.tsx');
const home = read('app/weather/(tabs)/work.tsx');
check('18 the story viewer has a progress bar per story, taps (left third back, otherwise on), hold to pause, and pull down to close', /storyDurationMs\(story\)/.test(viewer) && /tapZone\(x, width\)/.test(viewer) && /HOLD_MS/.test(viewer) && /setHolding\(true\)/.test(viewer) && /GestureDetector gesture=\{dismiss\}/.test(viewer) && /runOnJS\(goBack\)\(\)/.test(viewer) && /nextIndex\(index, stories\.length\)/.test(viewer));
check('19 a shared card: hold shows "Tap to see reel", a short tap opens the reel (or project), and the hold itself never opens it', /holding \? \(/.test(viewer) && /Tap to see reel/.test(viewer) && /if \(held\.current \|\| !target\) return/.test(viewer) && /shareTarget\(story, post\)/.test(viewer) && /pathname: `\$\{base\}\/work-video`/.test(viewer));
check('20 the story timer stops while held, while another screen is on top and when the app is switched away', /const playing = focused && !holding/.test(viewer) && /const focused = isFocused && appActive;/.test(viewer));
check('21 each watched story is remembered on the phone, and a video story gets a fresh player, played from the start', /markStorySeen\(story\.id/.test(viewer) && /<StoryLayer key=\{story\.id\}/.test(viewer) && /function StoryVideo/.test(viewer));
check('22 the profile picture has the ring: coloured while unwatched, grey when watched, none without stories; tapping it opens the stories at the first unwatched one', /ringState\(stories, seen\)/.test(home) && /startIndex\(stories, seen\)/.test(home) && /ring === 'unseen'/.test(home) && /#C5D2C0/.test(home));
const cardSrc = read('src/components/work/StoryCard.tsx');
check('23 the shared card is drawn from the owner\'s design (background, frame colour, thickness, roundness, size, text), not saved as one flat picture', /normalizeDesign/.test(cardSrc) && /borderWidth: design\.frameWidth/.test(cardSrc) && /borderRadius: design\.radius/.test(cardSrc) && /design\.background === 'blur'/.test(cardSrc) && /textPlace === 'top'/.test(cardSrc));
check('24 full-screen viewers (video and story) have no tab bar over them', /work-video'\) \|\| pathname\.startsWith\('\/weather\/work-story'\)\) return null/.test(read('src/components/weather/FloatingTabBar.tsx')) && /<Stack\.Screen name="work-story" options=\{\{ presentation: 'transparentModal', animation: 'fade', animationDuration: 160, gestureEnabled: false \}\} \/>/.test(read('app/weather/_layout.tsx')));

// ── the owner's tools (step 3) ──
const mgr = read('src/components/work/StoriesManagerScreen.tsx');
const own = read('src/data/portfolioStoriesOwner.ts');
check('25 the owner can add a photo or a video (a video of up to 60 seconds, checked before it is sent) to the story', /launchImageLibraryAsync\(\{ mediaTypes: \['images', 'videos'\]/.test(mgr) && /seconds > MAX_STORY_VIDEO_S/.test(mgr) && /addMediaStory\(/.test(mgr) && /storyProblem\(/.test(own));
check('26 a story video is shrunk first and a story lands in the owner\'s own company folder', /uploadImage\(source, `\$\{companyId\}\/portfolio\/stories`/.test(own) && /shrinkVideoUri/.test(own) && !/prepareImage/.test(own) && /keepPicked\(a\.uri/.test(read('src/components/work/StoriesManagerScreen.tsx')));
check('27 the owner can share a project or video: pick it, then design the card with a live preview before sharing', /startShare/.test(mgr) && /loadPostsToShare/.test(mgr) && /<Preview design=\{design\}/.test(mgr) && /addShareStory\(/.test(mgr) && /storyProblem\(\{ kind: 'share'/.test(own));
check('28 the card has colours, a gradient or blurred picture, frame colour, border thickness, roundness, size, and text above or below', /'Blurred picture'/.test(mgr) && /Frame color/.test(mgr) && /Border thickness/.test(mgr) && /Roundness/.test(mgr) && /Card size/.test(mgr) && /Above the card/.test(mgr) && /Text color/.test(mgr));
check('29 the owner sees every story that is up with its time left and can take any down (asked first)', /timeLeftLabel\(s\.expires_at/.test(mgr) && /deleteStory\(s\.id\)/.test(mgr) && /Take this down\?/.test(mgr));
check('30 the owner reaches it from Our Work (More > Our Work > Story) in both owner areas', /our-work-stories/.test(read('src/components/work/OurWorkManagerScreen.tsx')) && fs.existsSync(path.join(__dirname, '../../app/(owner)/our-work-stories.tsx')) && fs.existsSync(path.join(__dirname, '../../app/snow/owner/our-work-stories.tsx')));

const storyScreen = read('app/weather/work-story.tsx');
check('S1 pulling a story or highlight down moves the whole viewer with the finger, shrinks it and shows the screen behind; far or fast enough slides it away and closes, otherwise it springs back; a sideways move is never a pull', /Gesture\.Pan\(\)\s*\.activeOffsetY\(12\)\s*\.failOffsetY\(-12\)\s*\.failOffsetX\(\[-24, 24\]\)/.test(storyScreen) && /dragY\.value = Math\.max\(0, e\.translationY\)/.test(storyScreen) && /dragY\.value > 140 \|\| e\.velocityY > 900/.test(storyScreen) && /withTiming\(height, \{ duration: 220 \}, \(done\) => \{ if \(done\) runOnJS\(goBack\)\(\); \}\)/.test(storyScreen) && /withSpring\(0, \{ damping: 20, stiffness: 240 \}\)/.test(storyScreen) && /scale: 1 - p \* 0\.18/.test(storyScreen) && !/PanResponder/.test(storyScreen) && /!holding && !dragging/.test(storyScreen));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
