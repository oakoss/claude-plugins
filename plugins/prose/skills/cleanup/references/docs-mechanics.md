# Documentation mechanics

Structural rules from the Google developer documentation style guide, for cleaning up docs rather than free prose. Apply these in pass 4 when the text is a README, tutorial, how-to, or reference page.

## Headings

- Sentence case, no trailing period, no links, no numbering for sequence. Headings name the content — no teasers, no questions.
- Task headings: bare verb — "Create an instance", not "Creating an instance".
- Conceptual headings: noun phrase — "Migration to Google Cloud", not "Migrating to Google Cloud". Never lead with an "-ing" verb.
- One h1 per page; don't skip levels; content must follow every heading.
- Optional sections: "Optional: Customize your alias", not "Customize your alias (optional)".

## Lists

- Numbered = sequence; bulleted = unordered set; description list = term + definition. One item is not a list.
- Introduce with a complete sentence ending in a colon: "To get the USB driver, follow these steps:" — never a fragment the items complete ("Use the **Submit** button to:").
- Parallel structure across items. End items with periods unless every item is a single word, verb-less fragment, all code, or all link text.
- Never end a list or series with "etc." or "and so on"; introduce with "such as" or "including" instead.

## Paragraphs

- One idea per paragraph; more than 5-6 sentences means it's carrying too much.
- The key point goes in the first sentence — readers don't read every word. Single-sentence paragraphs are fine.

## Procedures

- One imperative action per step, stated as a complete sentence.
- Location before action: "In Google Docs, click **File > New > Document**." Goal before action: "To start a new document, click **File > New > Document**."
- A single-step procedure is a bullet, not a numbered "1."
- State the result in the same paragraph as the action: "Click **Run**. The query results appear."
- Menu paths collapse into one step with `>`: "Click **File > New > Document**."
- Don't write "run the following command" — say what the command does.

## Tables

- Three or more pieces of related data per item → table; paired data → description list; single values → list.
- Introduce with a complete sentence; say "the following table". No merged cells, no `colspan`/`rowspan`, no end punctuation in column headers, no tables for layout.

## Notices (Note / Caution / Warning)

- Note = useful but skippable; Caution = proceed carefully; Warning = don't, or irreversible.
- Use a note only when the information is out of flow AND not necessary for success. Never make a procedural step, prerequisite, or cross-reference a note.
- Notices lose force in numbers: don't stack them, don't scatter them across a page.

## Links

- Phrasing: "For more information **about** X, see Y" — "about", never "on"; "see", never "check out" or "refer to".
- Link text is a short descriptive phrase or the exact page title. Never "click here", "this document", or a raw URL.
- Punctuation goes outside the link. Flag surprises in the link itself: "(opens in a new tab)", "download the security features PDF".
- Link sparingly; define a term or give the two steps inline instead of sending the reader away.

## Code in text

- Code font: filenames, class/method names, commands, flags, environment variables, HTTP verbs and status codes, IP addresses, port numbers, keywords, anything the user types.
- Not code font: product names, domain names in prose, URLs the reader visits.
- Never inflect a code item — no plurals, possessives, or verbing. Add a noun and inflect that: "`Intent` objects", "send a `POST` request" (not "`POST` the data").
- Refer to files as "the `build.sh` file"; file types by format name ("a PNG file", not "a `.png` file").

## Placeholders and example data

- Placeholders: `UPPER_SNAKE_CASE`, informative names. Never `MY_PROJECT`, `YOUR_API_KEY`, `x`, or foo/bar/baz.
- Explain every placeholder: "Replace `PROJECT_ID` with ..." or "Replace the following:" plus a list.
- Example values: example.com domains, RFC 5737 IPs (192.0.2.0/24), 800-555-01xx phone numbers, the approved gender-neutral name roster (Alex, Dana, Kai, Quinn, ...).

## UI elements

- Bold every UI element name as displayed: "In the **New project** window, select the **New activity** checkbox."
- Verbs: click (mouse), tap (touch), press (keys), enter (text), select/clear (checkboxes — never check/uncheck), turn on/off (toggles — "toggle" isn't a verb).
- "Click **OK**", never "Click the OK button". Describe the task, not the widget, when the UI is obvious.
- No directional language ("above", "on the left") — name the element, add context, or show a screenshot.

## Numbers, dates, units

- Spell out zero through nine; numerals for 10+ and for all technical values (versions, limits, sizes). Spell out a number that starts a sentence.
- Dates: "January 19, 2017" or ISO 8601 (2017-01-19) — never 1/19/17. Avoid seasons; use months or quarters.
- Units: nonbreaking space between number and unit ("64 GB"); "requests per day", not "requests/day"; repeat units in ranges ("-40 °C to 85 °C").
- Ranges take a hyphen ("8-20 files") or "from 8 to 20 files" — never "from 8-20 files".

## Images and footnotes

- Images only when words can't carry it; never screenshots of code, text, or terminal output.
- Alt text on everything (≤155 characters, no "Image of"); decorative images get `alt=""`, never a missing attribute.
- Avoid footnotes entirely — use a cross-reference, a note, or a parenthetical.
