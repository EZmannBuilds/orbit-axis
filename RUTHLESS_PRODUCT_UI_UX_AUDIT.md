# Executive Summary

## Overall product impression

Orbit Axis has a credible core product inside an experience that is not yet coherent or trustworthy enough for public launch. The personalized natal chart and Ask Orbit flows prove there is a real product here. The surrounding shell still exposes unfinished roadmap areas, developer diagnostics, duplicated legacy tools, broken routes, and contradictory astrology data.

The intended product context was inferred from the live workspace and repository:

- **Product:** Orbit Axis
- **Purpose:** A calm, beginner-friendly daily astrology companion with personalized charts and evidence-grounded explanations
- **Primary audience:** Astrology-curious people who want understandable, personal guidance without needing technical astrology knowledge
- **Primary user goal:** Understand what today’s sky and their natal chart mean for them
- **Activation event:** The first useful personalized reading or chart explanation
- **Primary conversion event today:** Account creation; no billing exists
- **Business model today:** Free/private beta; subscriptions are only planned
- **Known constraints:** Symbolic reflection rather than guaranteed prediction; deterministic calculations; optional local language model; unfinished Tarot, Learn, News, compatibility, analytics, billing, export, and account deletion

## Strongest part of the experience

The strongest part is the combination of **Me** and **Ask Orbit**. Me gives a clear Big Three entry point, and Ask Orbit offers relevant suggested questions, fast answers, and a visible evidence disclosure. These two screens express the product’s actual differentiator better than the Home page does.

## Most damaging problem

Orbit contradicts itself about the sky in the same session. On July 27 local time, Home said the Moon was a **Full Moon, 98% illuminated and waning**; Transits and Overview said **Waxing Gibbous, 98% illuminated and waxing**, with the next full moon on July 29. Home also labeled the daily fortune **2026-07-28** while the app header and local timestamp were still July 27. An astrology product cannot survive visible disagreement about its foundational data.

## Estimated readiness

**Early beta.** The working core is beyond a prototype, but the product is not launch-ready.

## The three changes most likely to improve results

1. Make one time-zone-aware sky service the canonical source for Home, Overview, Transits, fortunes, history, and Ask Orbit.
2. Replace account-first onboarding with a short, privacy-explicit path that demonstrates a personalized insight before asking the user to create an account.
3. Remove unfinished primary navigation and all consumer-visible developer surfaces until they provide complete user value.

## Audit scope and evidence

Directly tested against the exact workspace build at `http://localhost:3002` on July 27, 2026:

- Disposable local account creation
- First-run onboarding, dismissal, chart creation, and activation
- Home, Me, placement detail, Ask Orbit, Ask history, Tarot, Learn, News, More, Settings, Overview, Transits, Research, History, command palette, chart modal, sign-in, sign-up validation, and error states
- Approximately 1280px desktop, 768px tablet, and 375px mobile
- Keyboard focus order, dialog Escape behavior, text-size mode, page overflow, control dimensions, and accessible names

Evidence references used below:

- **E1:** 1280px sign-in and first-run onboarding
- **E2:** 1280px signed-in Home before and after activation
- **E3:** 1280px Me and placement detail
- **E4:** 1280px Ask Orbit empty state, answer, evidence, and history
- **E5:** 1280px More, Settings, Overview, Transits, Research, and command palette
- **E6:** 375px Home, Me, Ask Orbit, chart modal, Settings, and sign-in
- **E7:** 768px Home and bottom navigation
- **E8:** Keyboard focus sequence and modal focus restoration
- **E9:** Direct route checks for `#charts`, `/terms`, and `/privacy`

# Critical Findings

## Orbit presents contradictory sky and calendar data

- **Severity:** Critical
- **Page or flow:** Home, Today’s Fortune, Fortune History, Overview, Transits
- **Pass discovered in:** Pass 1 and Pass 2
- **Observation:** In one session, Home reported “Full Moon · 98% lit” and described the Moon as waning. Overview and Transits reported “Waxing Gibbous,” 98% illuminated and waxing, with the next full moon on July 29. At 10:48 PM local time on July 27, Today’s Fortune and History were dated July 28.
- **Why it matters:** Sky calculation is the product’s factual foundation. Contradictory phase and date data makes every interpretation feel arbitrary and undermines confidence in saved history and Ask Orbit evidence.
- **Recommended change:** Create one canonical current-sky and local-day contract. Pass an explicit user time zone to every daily calculation. Remove or quarantine legacy mean-cycle results where Swiss Ephemeris results are available. Add cross-screen contract tests for phase, waxing/waning state, local date, next-event date, and fortune date.
- **Expected effect:** Higher trust, fewer “the app is wrong” moments, and a defensible foundation for personalized interpretation.
- **Confidence:** High
- **Evidence or screenshot reference:** E2, E5; Home DOM and Transits DOM in the same authenticated session

## The sign-in gate is visually modal but inaccessible as a modal

- **Severity:** Critical
- **Page or flow:** Signed-out entry, sign-in, account creation
- **Pass discovered in:** Pass 4
- **Observation:** `#auth-gate` has no dialog role, no `aria-modal`, no accessible title association, and does not make the app shell inert or `aria-hidden`. From a fresh reload, Tab moved through Skip to content, Home, Me, Tarot, Ask Orbit, Learn, News, More, and background page controls before reaching any sign-in control.
- **Why it matters:** Keyboard and screen-reader users cannot reach the only available task in a predictable way. The visual overlay says the background is unavailable while the accessibility tree says the opposite.
- **Recommended change:** Implement the auth gate through the same tested modal utility used by signed-in dialogs. Give it `role="dialog"`, `aria-modal="true"`, and `aria-labelledby`. Move focus into the first auth control, trap focus, make the application shell inert while open, and restore focus only when appropriate.
- **Expected effect:** Removes a primary-task blocker and aligns visual and assistive-technology behavior.
- **Confidence:** High
- **Evidence or screenshot reference:** E1, E6, E8; direct tab sequence

## Orbit collects sensitive account and birth data without launch-grade user controls

- **Severity:** Critical
- **Page or flow:** Account creation, chart setup, More → Account
- **Pass discovered in:** Pass 2 and Pass 3
- **Observation:** Account creation shows no Terms, Privacy Policy, data-use explanation, support path, or password recovery. Direct `/terms` and `/privacy` requests fall back to the signed-out Home app. Chart setup then requests birth date, time, and birthplace. More → Account says export is planned and account deletion is intentionally disabled.
- **Why it matters:** Birth details and saved charts are sensitive personal data. Asking for them without usable privacy information, recovery, export, or deletion controls creates immediate trust and launch risk.
- **Recommended change:** Before collecting chart data, publish plain-language Terms and Privacy pages, explain what is stored and why, add password reset and support, and implement tested account deletion and export. Do not claim launch readiness until those controls and the open Swiss Ephemeris licensing dependency are resolved.
- **Expected effect:** Reduces signup anxiety, makes the data exchange understandable, and removes a major public-launch blocker.
- **Confidence:** High
- **Evidence or screenshot reference:** E1, E5, E9; More → Account text and direct route tests

# High-Impact Findings

## Account creation is required before the product demonstrates personal value

- **Severity:** High Impact
- **Page or flow:** First arrival → account creation
- **Pass discovered in:** Pass 2 and Pass 3
- **Observation:** The first visible surface is a full-screen account gate. Its promise is limited to saving charts and restoring readings across devices. The useful Current Sky interface is blurred behind it.
- **Why it matters:** A new user is asked to trust Orbit with an email before seeing why Orbit is different from any generic horoscope or astrology app.
- **Recommended change:** Let signed-out users view Current Sky and enter a temporary chart. Show one meaningful personalized insight, then ask them to create an account to save the chart, unlock history, and continue in Ask Orbit.
- **Expected effect:** Faster time to value and a better-informed account conversion.
- **Confidence:** High
- **Evidence or screenshot reference:** E1

## The first personalized value is below the fold and the first card is not personalized

- **Severity:** High Impact
- **Page or flow:** Home after chart creation
- **Pass discovered in:** Pass 1, Pass 2, and Pass 3
- **Observation:** After saving a chart, Home says “Reading for: My Chart,” but the first large module is the generic Current Sky. At 1280×900, the first fortune sentence began at approximately y=890. At 375px, Current Sky occupied about 687px and the fortune did not begin until approximately y=1139.
- **Why it matters:** The activation promise is personalization, but the interface makes users scroll past generic sky data before seeing the result of the data they just entered.
- **Recommended change:** Put one clearly personalized summary directly under “Reading for.” Compress Current Sky into a secondary module. On mobile, show the personalized sentence and its evidence before the large decorative sky card.
- **Expected effect:** Makes activation obvious and reduces the chance users conclude that chart setup changed nothing.
- **Confidence:** High
- **Evidence or screenshot reference:** E2, E6; measured element positions

## Three primary navigation destinations are public placeholders

- **Severity:** High Impact
- **Page or flow:** Tarot, Learn, News
- **Pass discovered in:** Pass 1
- **Observation:** Tarot says the system is not wired and all three modes are “Coming soon.” Learn contains three planned course cards and no lesson. News says there is no feed. Tarot still offers “Ask About This Reading” when no reading exists; News offers “Ask about an article” when no article exists.
- **Why it matters:** Nearly half of the seven-item primary navigation advertises unavailable value. This makes the product feel broader but substantially less finished.
- **Recommended change:** Remove Tarot, Learn, and News from primary navigation until each has one complete end-to-end experience. If roadmap visibility is necessary, place a compact, non-interactive “Coming later” note under More.
- **Expected effect:** A smaller product that feels intentional and credible.
- **Confidence:** High
- **Evidence or screenshot reference:** Direct browser inspection of the three primary panels

## Chart and comparison actions route to a nonexistent workspace

- **Severity:** High Impact
- **Page or flow:** More → Chart tools, More → Compatibility, Overview → Open charts, Overview quick actions, command palette → Look up a birth sign
- **Pass discovered in:** Pass 2
- **Observation:** These actions navigate to `#charts`, but `charts` is absent from the workspace registry. The router silently falls back to Home even though a `panel-charts` exists in the document.
- **Why it matters:** Multiple explicit actions do not deliver their named destination, teaching users that buttons are unreliable.
- **Recommended change:** Either restore `charts` to the workspace registry and test every entry point, or remove the legacy chart panel and redirect each action to a working, named alternative.
- **Expected effect:** Restores task completion for birth-sign and comparison tools and removes silent failure.
- **Confidence:** High
- **Evidence or screenshot reference:** E5, E9; direct `#charts` route remained titled “Orbit Axis — Home”

## Mobile chart management has overflow and undersized controls

- **Severity:** High Impact
- **Page or flow:** 375px Add a chart modal
- **Pass discovered in:** Pass 4
- **Observation:** The modal panel had a client width of 338px and scroll width of 360px, producing a visible horizontal scrollbar. Inputs and selects measured roughly 34–39px tall; Cancel and Save chart were 38px tall; Close was 40px.
- **Why it matters:** Chart creation is a core task and the form is harder to scan and operate on touch devices. The scrollbar makes the modal look broken.
- **Recommended change:** Remove the panel’s horizontal overflow source, collapse the form to one column at phone widths, and make every input, select, and button at least 44×44 CSS pixels.
- **Expected effect:** More reliable chart creation and a visibly finished mobile experience.
- **Confidence:** High
- **Evidence or screenshot reference:** E6; direct geometry measurements

## Touch targets fail repeatedly outside the modal

- **Severity:** High Impact
- **Page or flow:** Mobile Me, Ask Orbit, Settings
- **Pass discovered in:** Pass 4
- **Observation:** Me’s Add Chart and Edit Chart buttons measured 38px tall. Ask Orbit’s History and New conversation controls measured 32px. Settings segmented buttons measured 26px even in Large text mode.
- **Why it matters:** These controls are difficult for users with limited dexterity and fail the commonly expected 44px mobile target.
- **Recommended change:** Establish a global 44px minimum interactive target token and apply it to all button variants, segmented controls, and icon buttons.
- **Expected effect:** Better accessibility and fewer missed taps.
- **Confidence:** High
- **Evidence or screenshot reference:** E6; direct control measurements

## Consumer UI exposes developer and infrastructure surfaces

- **Severity:** High Impact
- **Page or flow:** Left rail, More → Local Intelligence, More → Account, Settings, Overview, News, Research
- **Pass discovered in:** Pass 1
- **Observation:** Users see “Systems nominal,” port numbers, symbol counts, “Deterministic + local fallback,” Ollama connectivity, model name `qwen3:14b`, context tokens, prompt version, a roadmap prompt, “Propose note,” Supabase, and the product documentation vault.
- **Why it matters:** These details make the product feel like an internal tool, create avoidable security questions, and distract from the user’s astrology task.
- **Recommended change:** Gate diagnostics behind a development-only flag and remove them from production markup. Replace infrastructure language with user outcomes only where a status genuinely affects the task.
- **Expected effect:** Higher perceived quality and a clearer consumer product identity.
- **Confidence:** High
- **Evidence or screenshot reference:** E5

## The no-chart state contradicts the user’s authenticated state and duplicates setup

- **Severity:** High Impact
- **Page or flow:** First-run onboarding dismissal → signed-in Home
- **Pass discovered in:** Pass 2
- **Observation:** After the signed-in user closes “Set up My Chart,” Home shows another “Set up your chart” form that says “Sign in to save this as My Chart.” The plus action opens a third form variant with Nickname and Relationship fields.
- **Why it matters:** The product does not appear to remember that the user signed in or made an onboarding choice. Three competing setup variants create uncertainty about which data is required.
- **Recommended change:** Use one chart-creation component and one copy system. In signed-in zero-chart state, show a single inline CTA or reopen the same form. Never show signed-out copy to an authenticated user.
- **Expected effect:** Less hesitation and fewer abandoned chart setups.
- **Confidence:** High
- **Evidence or screenshot reference:** E1, E2

## Product positioning conflicts across the experience

- **Severity:** High Impact
- **Page or flow:** Home, Ask Orbit, Settings → About, Research, repository metadata
- **Pass discovered in:** Pass 1 and Pass 3
- **Observation:** The visible product presents a personal daily astrology companion. Settings says Orbit is for “creative and brand work,” while Research interpretations repeatedly discuss design motifs. The rest of the app asks personal life and relationship questions.
- **Why it matters:** Users cannot tell whether this is a personal astrology product, a creative inspiration tool, or an internal brand-research utility.
- **Recommended change:** Choose one primary audience and rewrite the promise, examples, disclaimer, symbol content, and onboarding around that audience. Move secondary professional use cases out of the core journey.
- **Expected effect:** Better comprehension, more relevant acquisition, and clearer pricing possibilities later.
- **Confidence:** High
- **Evidence or screenshot reference:** E2, E4, E5

# Medium-Impact Findings

## Simple mode still exposes advanced astrology language

- **Severity:** Medium Impact
- **Page or flow:** Me, placement detail, Home
- **Pass discovered in:** Pass 1 and Pass 2
- **Observation:** In Simple mode, Me shows houses, exact degrees, retrograde status, “Mars chart ruler,” and an Advanced notes section inside placement details.
- **Why it matters:** “Simple” does not reliably reduce prior knowledge requirements, so beginners still need to decode technical terms.
- **Recommended change:** In Simple mode, lead with plain-language meaning and hide exact degree, house, modality, longitude, and chart-ruler details behind an explicit “Technical details” disclosure.
- **Expected effect:** Better comprehension without removing advanced data.
- **Confidence:** High
- **Evidence or screenshot reference:** E3

## Ask Orbit answers are fast but the wording and evidence need quality guards

- **Severity:** Medium Impact
- **Page or flow:** Ask Orbit first suggested question
- **Pass discovered in:** Pass 2
- **Observation:** The answer said “Jupiter opposition your natal Venus,” repeated the same point in consecutive paragraphs, and added a Moon interpretation without explaining why it mattered. The evidence drawer listed six chart facts but did not connect each fact to the conclusion.
- **Why it matters:** Grammar errors and unexplained evidence weaken the strongest differentiated feature.
- **Recommended change:** Add output checks for aspect grammar, duplication, and evidence-to-claim mapping. Show the two or three decisive facts first and explain each connection.
- **Expected effect:** More useful answers and stronger trust in the evidence promise.
- **Confidence:** High
- **Evidence or screenshot reference:** E4

## Ask Orbit’s mobile composer is below the first viewport

- **Severity:** Medium Impact
- **Page or flow:** 375px Ask Orbit empty state
- **Pass discovered in:** Pass 4
- **Observation:** Six stacked suggestions push the textarea to about y=863 and the Ask button to y=942. The viewport is 812px tall.
- **Why it matters:** The page’s primary action is not immediately available to someone who wants to type their own question.
- **Recommended change:** Show three suggestions initially, add “More ideas,” and keep the composer above them or sticky above the bottom navigation.
- **Expected effect:** Faster question submission on mobile.
- **Confidence:** High
- **Evidence or screenshot reference:** E6

## Navigation contains duplicate and legacy mental models

- **Severity:** Medium Impact
- **Page or flow:** Home, Overview, Ask Orbit, Research, More, command palette
- **Pass discovered in:** Pass 1
- **Observation:** Home and Overview both summarize the sky; central Ask Orbit and Research both use the name “Ask Orbit”; More links to legacy tools; the command palette reveals raw `#route` fragments and hidden workspaces.
- **Why it matters:** Users must infer which version of a concept is current and which is technical or legacy.
- **Recommended change:** Make Home the only overview, Ask Orbit the only conversational surface, and Atlas a clearly named reference tool. Remove hash fragments and internal-only destinations from user-facing commands.
- **Expected effect:** Lower cognitive load and fewer wrong turns.
- **Confidence:** High
- **Evidence or screenshot reference:** E4, E5

## Secondary tab panels have no accessible name

- **Severity:** Medium Impact
- **Page or flow:** Settings, Overview, Transits, Research, History
- **Pass discovered in:** Pass 4
- **Observation:** These panels use `aria-labelledby="tab-…"`, but their corresponding tab links are not rendered in the primary rail. Browser accessibility snapshots reported unnamed tab panels.
- **Why it matters:** Screen-reader users enter a region without a programmatic section name.
- **Recommended change:** Use `aria-labelledby` pointing to each page’s visible heading, or render a valid controlling tab. Prefer page/region semantics over tab semantics for routed workspaces.
- **Expected effect:** Clearer screen-reader navigation.
- **Confidence:** High
- **Evidence or screenshot reference:** E5

## Mobile Me is extremely long and repeats identity before insight

- **Severity:** Medium Impact
- **Page or flow:** 375px Me
- **Pass discovered in:** Pass 1 and Pass 4
- **Observation:** The page measured roughly 3,245px tall. “Me,” “My Chart,” Active, “Active chart loaded,” and another My Chart card appear before the Big Three explanations.
- **Why it matters:** Repetition delays the content users opened the page to see and increases mobile scrolling.
- **Recommended change:** Collapse the repeated status layer into one compact chart header and lead directly into the Big Three.
- **Expected effect:** Faster access to useful chart content.
- **Confidence:** High
- **Evidence or screenshot reference:** E3, E6

## Visual hierarchy over-prioritizes Ask Orbit and system chrome

- **Severity:** Medium Impact
- **Page or flow:** Desktop rail and mobile bottom navigation
- **Pass discovered in:** Pass 1
- **Observation:** Ask Orbit is permanently bright, raised, glowing, and animated even on unrelated tasks. “Systems nominal” and Command occupy persistent rail space. Other navigation items are comparatively faint.
- **Why it matters:** The shell continuously competes with the active page and can feel promotional rather than calm.
- **Recommended change:** Reserve the strongest Ask treatment for its selected state or a contextual CTA. Remove system status from the consumer shell and increase inactive-label readability.
- **Expected effect:** Calmer hierarchy and better focus.
- **Confidence:** High
- **Evidence or screenshot reference:** E2–E7

## Placeholder and engineering copy makes incompleteness feel accidental

- **Severity:** Medium Impact
- **Page or flow:** Tarot, Learn, News, More, Overview, Research
- **Pass discovered in:** Pass 1
- **Observation:** Copy includes “not wired yet,” “will live here,” “as the app grows,” “Deterministic synastry,” “deterministic engine,” and “Ollama will not invent headlines.”
- **Why it matters:** Honest empty states are good, but exposing roadmap and implementation language makes the app feel like a staging environment.
- **Recommended change:** Remove unavailable sections from navigation. Where an empty state remains, explain the user benefit and a real next action without implementation language.
- **Expected effect:** More deliberate perceived quality.
- **Confidence:** High
- **Evidence or screenshot reference:** Direct inspection of the named panels

# Nice-to-Have Improvements

## Replace the standalone plus with a labeled chart action

- **Severity:** Nice to Have
- **Page or flow:** Home chart picker
- **Pass discovered in:** Pass 1
- **Observation:** A 44px plus appears without visible text between the chart selector and Manage.
- **Why it matters:** The accessible name is good, but sighted users must infer whether it adds a chart, person, or reading.
- **Recommended change:** Use “Add chart” on desktop and retain the plus with a visible tooltip on compact layouts.
- **Expected effect:** Less hesitation.
- **Confidence:** High
- **Evidence or screenshot reference:** E2, E6

## Standardize dates for human reading

- **Severity:** Nice to Have
- **Page or flow:** Home fortune, History, Overview, Transits
- **Pass discovered in:** Pass 1
- **Observation:** Some surfaces use “Monday, July 27,” while others use ISO dates such as `2026-07-28`.
- **Why it matters:** ISO dates feel technical and make the date contradiction harder to notice and understand.
- **Recommended change:** Use localized human dates in the interface and reserve ISO dates for exports or technical detail.
- **Expected effect:** Better readability and consistency.
- **Confidence:** High
- **Evidence or screenshot reference:** E2, E5

## Make button hierarchy consistent on More

- **Severity:** Nice to Have
- **Page or flow:** More
- **Pass discovered in:** Pass 1
- **Observation:** Saved Charts and History use full-width primary buttons while similar destination cards use small secondary buttons, leaving an uneven grid and unclear priority.
- **Why it matters:** The visual hierarchy does not map to task importance.
- **Recommended change:** Use one card-action pattern and order cards by usage and value.
- **Expected effect:** Cleaner scanning and a more deliberate grid.
- **Confidence:** High
- **Evidence or screenshot reference:** E5

# First-Time User Journey

1. **Arrival**
   - **Expected:** A clear explanation of what Orbit does and a way to try it.
   - **Clicked:** Nothing initially.
   - **Actual:** A full-screen sign-in card focused on persistence benefits.
   - **Hesitation:** The product asks for an account before showing a personal result, and provides no privacy, terms, support, or recovery path.
   - **Confidence risk:** The background suggests useful content exists but prevents interaction.

2. **Create account**
   - **Expected:** A short signup with clear password and data expectations.
   - **Clicked:** Create account.
   - **Actual:** Email, password, and confirm password. Account creation was fast and a mismatched password produced a clear status message.
   - **Hesitation:** No visible password guidance beyond browser validation, no privacy context, and no explanation of what happens next.

3. **First-run chart setup**
   - **Expected:** The minimum information needed for a first personal reading.
   - **Clicked:** The chart setup form.
   - **Actual:** First name, last name, birth date, birth time, time accuracy, and birthplace. Birthplace search returned clear matches and confirmed that time zone would be detected.
   - **Hesitation:** Optional versus required fields are not explained. The copy emphasizes naming and system state rather than the insight the user will receive.
   - **Onboarding memory:** Dismissing the modal was remembered for the session, but the replacement Home form contradicted the signed-in state.

4. **Alternative chart setup after dismissal**
   - **Expected:** The same setup flow.
   - **Clicked:** The plus button.
   - **Actual:** A third chart form with Nickname and Relationship added.
   - **Hesitation:** It is unclear why first-run chart creation has multiple versions or whether relationship is relevant to “My Chart.”

5. **Activation**
   - **Expected:** A personal insight immediately after saving.
   - **Clicked:** Save chart.
   - **Actual:** Home showed “Reading for: My Chart,” then a generic Current Sky card. The personal fortune began at or below the desktop fold and much farther below the mobile fold.
   - **Value received:** Yes, after scrolling.
   - **Confidence loss:** The fortune used the next UTC date and the Moon phase later contradicted Overview and Transits.

6. **Me**
   - **Expected:** A readable explanation of the saved chart.
   - **Actual:** This was strong. The Big Three and planet cards were clear entry points, though Simple mode retained substantial jargon.

7. **Ask Orbit**
   - **Expected:** A question tied to the saved chart.
   - **Clicked:** A suggested prompt.
   - **Actual:** A fast, relevant answer with an evidence drawer and history.
   - **Confidence loss:** Grammar, repetition, and unexplained evidence weakened the answer.

8. **Broader exploration**
   - **Actual:** Tarot, Learn, and News were placeholders; chart-tool actions silently returned Home; More exposed internal diagnostics and missing account controls.
   - **Likely abandonment point:** The user realizes the working product is narrower and less internally consistent than the navigation implied.

# Conversion and Activation Analysis

## Current activation path

Arrival → create account → chart onboarding → enter six birth/profile fields → select birthplace → save chart → generic Current Sky → scroll to personal fortune → optionally open Me or Ask Orbit.

## Main drop-off risks

- Account request before demonstrated personal value
- No privacy, legal, support, or password-recovery reassurance
- Birth-time uncertainty without a clear “you can continue without it” explanation
- Multiple chart setup variants
- Personalized result below generic content
- Contradictory dates and Moon phase
- Placeholder primary sections that overstate product breadth

## Upgrade timing assessment

No upgrade, trial, pricing, or billing surface exists. That is appropriate for the current maturity. Introducing payment before fixing data consistency, privacy controls, and activation would compound distrust.

## Free-tier experience assessment

The current product behaves as a free account-required beta, not a conventional free tier. It offers meaningful chart and Ask Orbit value after setup, but no signed-out preview and no explanation of future limits.

## Trust risks

- Contradictory sky data and daily dates
- No privacy/terms/support/recovery
- No export or account deletion
- Infrastructure and model details exposed to consumers
- “Simple” mode that still assumes astrology knowledge
- Broken actions and primary placeholders

## Recommended activation path

1. Show Current Sky without an account.
2. Offer one clear CTA: **Get my personal reading**.
3. Ask only for birth date, birth-time accuracy/time, and birthplace; make name optional.
4. Explain why each item is needed and whether it is stored.
5. Show one personal insight with a plain-language “Why.”
6. Ask the user to create an account to save the chart, continue in Ask Orbit, and build history.
7. Land on the personal insight, not the generic sky.

## Recommended conversion path

Personal preview → first useful insight → account creation to save → first Ask Orbit answer → return visit/history. If a paid tier is added later, offer it only after repeated value and with a concrete feature boundary such as deeper history, multiple charts, or advanced synthesis. Do not paywall data access, deletion, basic privacy controls, or account recovery.

# Responsive and Accessibility Findings

## Confirmed issues

- No page-level horizontal overflow was found on Home, Me, Ask Orbit, or sign-in at 375px.
- No page-level horizontal overflow was found on Home at 768px.
- The 375px chart modal itself horizontally overflowed and displayed a scrollbar.
- Mobile Me, Ask Orbit, Settings, and chart-modal controls include targets below 44px.
- The seven-item mobile navigation is operable and its targets measured about 47×50px, with Ask about 47×62px, but labels are crowded at 10–11px.
- At 375px, the personal fortune starts far below the first viewport.
- At 375px, the Ask Orbit composer starts below the first viewport.
- The auth gate is not a semantic modal and does not trap focus.
- Signed-in chart and placement dialogs did respond to Escape; chart-modal focus returned to the Add a chart control.
- Large text mode did not create horizontal page overflow at 375px, but Settings targets remained only 26px tall.
- Secondary routed tab panels are unnamed in the accessibility tree.
- Reduced-motion styles exist in the code, but the operating-system preference was not directly simulated.

## Items requiring manual verification

- VoiceOver, NVDA, and TalkBack announcement quality
- Numerical WCAG contrast across dark, light, and high-contrast themes
- Browser zoom at 200% and text-only zoom
- iOS safe-area behavior on physical devices
- Swipe behavior and screen-reader interaction in the fortune carousel
- Focus order and announcement of dynamically streamed or updated Ask Orbit content
- Motion sensitivity with real reduced-motion system settings
- Touch behavior of birthplace result lists with an on-screen keyboard

# Patterns Across the Product

1. **Two products are competing:** a personal astrology companion and an internal deterministic/design-research observatory.
2. **Legacy and redesigned surfaces coexist:** Home versus Overview, central Ask versus Research Ask, multiple chart forms, and a missing chart workspace.
3. **The shell advertises roadmap breadth instead of current value:** three primary sections are placeholders.
4. **Technical honesty is expressed as implementation detail:** “Ollama,” “deterministic,” ports, prompt versions, and database names replace user-facing explanations.
5. **Progressive disclosure is inconsistent:** Simple mode and evidence panels still expose raw astrology jargon.
6. **Accessibility quality is uneven:** signed-in dialogs are thoughtfully handled, while the first and most important auth gate is not.
7. **Activation is structurally buried:** the app emphasizes generic sky, navigation, and system state before the user’s personal result.

# Prioritized Implementation Plan

## 1. Fix before showing more users

### Establish a canonical sky and local-day model

- **Problem being solved:** Contradictory Moon phase, waxing/waning, event, fortune, and history dates
- **Affected pages or components:** Home, Fortune, History, Overview, Transits, Ask Orbit evidence
- **Specific change:** Use one time-zone-aware sky result and one local-day key across all services.
- **Acceptance criteria:** In one session, every surface agrees on local date, Moon phase, waxing/waning state, illumination, and next full/new Moon. Automated tests cover UTC date rollover in at least three time zones.
- **Dependencies or risks:** Legacy mean-cycle endpoints, fortune storage keys, cached sky summaries

### Make authentication accessible

- **Problem being solved:** Keyboard and screen-reader users traverse the obscured app before sign-in
- **Affected pages or components:** Auth gate and app shell
- **Specific change:** Convert auth gate to a focus-trapped modal and make background content inert.
- **Acceptance criteria:** Initial focus is inside auth; Tab cannot escape; Escape behavior is intentional; screen readers announce title and purpose; background controls are absent from the active accessibility tree.
- **Dependencies or risks:** Startup-gate stacking and focus restoration

### Remove or hide incomplete and internal surfaces

- **Problem being solved:** Placeholder navigation and developer UI damage perceived quality
- **Affected pages or components:** Tarot, Learn, News, Local Intelligence, system status, Settings system card, command palette
- **Specific change:** Ship only Home, Me, Ask Orbit, and a simplified More until other destinations are complete. Development diagnostics render only in an explicit development mode.
- **Acceptance criteria:** Every primary navigation item completes a real user task; production DOM contains no port, model, prompt-version, vault, or proposal controls.
- **Dependencies or risks:** Product roadmap expectations and developer access to diagnostics

### Repair all broken chart-tool routes

- **Problem being solved:** Named actions silently return Home
- **Affected pages or components:** More, Overview, command palette, workspace registry
- **Specific change:** Register the chart workspace or remove/redirect every `#charts` action.
- **Acceptance criteria:** Every CTA lands on the page named by its label and has an automated navigation test.
- **Dependencies or risks:** Decision on whether legacy chart tools remain in the product

### Consolidate chart onboarding

- **Problem being solved:** Three chart forms, contradictory signed-in copy, and delayed value
- **Affected pages or components:** Auth onboarding, Home no-chart state, Add chart modal
- **Specific change:** Reuse one responsive form, distinguish first chart from additional charts, and land on the first personal insight.
- **Acceptance criteria:** One field/copy model; authenticated copy never asks the user to sign in; optional fields are labeled; first personal insight is visible without scrolling at 375px and 1280px.
- **Dependencies or risks:** Saved-chart naming and relationship metadata

### Fix mobile target sizes and modal overflow

- **Problem being solved:** Touch difficulty and visibly broken modal layout
- **Affected pages or components:** Chart modal, Me, Ask Orbit, Settings
- **Specific change:** Enforce a 44px minimum target and a one-column phone form; remove internal horizontal overflow.
- **Acceptance criteria:** No horizontal scrollbar at 320–430px; every interactive target is at least 44×44px; on-screen keyboard does not hide Save.
- **Dependencies or risks:** Legacy feature CSS overriding design-system components

## 2. Fix before public launch

### Complete the account trust layer

- **Problem being solved:** Sensitive data without legal, recovery, deletion, export, or support controls
- **Affected pages or components:** Signup, account settings, public routes
- **Specific change:** Publish Terms, Privacy, support, password reset, data export, and permanent account deletion.
- **Acceptance criteria:** Links are visible before signup; reset works end-to-end; export is readable; deletion removes or schedules removal of all owned data and clearly confirms the result.
- **Dependencies or risks:** Legal review, Supabase Auth flows, retention requirements, licensing

### Choose and enforce one product positioning

- **Problem being solved:** Personal-companion and creative-brand-tool messages conflict
- **Affected pages or components:** Metadata, Home, Settings, Research, onboarding, marketing
- **Specific change:** Define the primary target user and rewrite promises, examples, and disclaimers around their job.
- **Acceptance criteria:** Five first-time target users can explain what Orbit does, for whom, and why it is different after viewing the entry experience.
- **Dependencies or risks:** Business strategy and future pricing

### Make Simple mode genuinely beginner-first

- **Problem being solved:** Technical jargon appears despite Simple selection
- **Affected pages or components:** Me, placement details, Home, Ask evidence
- **Specific change:** Hide technical degrees/houses/modality behind disclosure and lead with meaning.
- **Acceptance criteria:** A beginner can interpret the Big Three and one current influence without prior astrology vocabulary.
- **Dependencies or risks:** Content design and mapping technical evidence to plain language

### Add Ask Orbit language-quality checks

- **Problem being solved:** Grammar, repetition, and evidence lists that do not justify claims
- **Affected pages or components:** Ask presenter and formatter
- **Specific change:** Validate aspect phrasing, deduplicate sentences, and map each conclusion to decisive evidence.
- **Acceptance criteria:** Fixture tests cover every aspect phrase; no duplicate paragraph; evidence explains relevance, not just source facts.
- **Dependencies or risks:** Deterministic formatter and optional model output

## 3. Improve after launch

### Simplify Home and Me hierarchy

- **Problem being solved:** Repeated identity/status and excessive mobile height
- **Affected pages or components:** Home, Me
- **Specific change:** Compress chart controls, lead with personal meaning, and collapse secondary planet detail.
- **Acceptance criteria:** The first useful personal insight is visible in the initial viewport; Me reaches Big Three with no repeated chart heading.
- **Dependencies or risks:** User preference for overview versus detail

### Normalize visual component hierarchy

- **Problem being solved:** Inconsistent buttons, card actions, and persistent Ask emphasis
- **Affected pages or components:** Rail, bottom navigation, More, dialogs
- **Specific change:** Standardize action priority and reduce unselected glow.
- **Acceptance criteria:** One primary action per screen; card actions share a consistent position and style; inactive navigation remains readable.
- **Dependencies or risks:** Brand direction

### Refine dates and empty states

- **Problem being solved:** Technical dates and roadmap copy
- **Affected pages or components:** Fortune, History, Transits, future-content sections
- **Specific change:** Use localized dates and outcome-oriented empty states.
- **Acceptance criteria:** No implementation or roadmap language in production empty states.
- **Dependencies or risks:** Localization strategy

## 4. Experiments requiring analytics or user testing

### Guest preview versus account-first

- **Problem being solved:** Unknown account-gate abandonment
- **Affected pages or components:** Entry and onboarding
- **Specific change:** Compare account-first with temporary-chart-first.
- **Acceptance criteria:** Measure chart-start, first-insight, account-create, day-2 return, and privacy-page engagement.
- **Dependencies or risks:** Analytics consent and anonymous-session design

### Personal-first Home ordering

- **Problem being solved:** Personalized value below generic sky
- **Affected pages or components:** Home
- **Specific change:** Test personal summary before Current Sky versus current order.
- **Acceptance criteria:** Compare first meaningful interaction, Ask click-through, scroll depth, and return rate.
- **Dependencies or risks:** Canonical sky fix must land first

### Number and prominence of primary navigation items

- **Problem being solved:** Seven-item navigation and oversized Ask emphasis may not match real usage
- **Affected pages or components:** Desktop rail and mobile bottom navigation
- **Specific change:** Test four core destinations with secondary features under More.
- **Acceptance criteria:** Compare task success, wrong-route visits, and navigation comprehension.
- **Dependencies or risks:** Complete features only; do not test placeholder demand through misleading navigation

# Final Verdict

- **Would a first-time target user understand the product?** Partly. They would understand that it is a personal astrology app, but not why it is distinct or whether it is also a creative/brand tool.
- **Would they reach meaningful value?** Yes, after account creation, chart setup, and scrolling. The path is longer and less decisive than it should be.
- **Would they trust it?** Not yet. Contradictory sky/date data and missing account/privacy controls are disqualifying.
- **Would they pay for it?** Not in the current state. There is no paid offer, and the core trust layer is not strong enough to support one.
- **What is the single biggest reason they might leave?** Orbit asks for personal data before proving value, then visibly disagrees with itself about the sky.
