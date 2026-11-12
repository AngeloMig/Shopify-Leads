import type { Finding, PsiSample } from "./types.js";
import type { ReportIssue } from "./audit-presentation.js";

type Copy = {
  match: RegExp;
  title: string;
  meaning?: string;
  /** What it costs the business, in a shopper's terms. */
  why?: string;
  /** What the owner gets once it's fixed. */
  gain?: string;
  action?: string;
  validation?: string;
};
const copy: Copy[] = [
  {
    match: /contrast/i,
    title: "Some text is difficult to read",
    gain: "Prices, buttons and delivery notes are easy to read, even on a phone in bright light.",
    meaning:
      "Some text does not stand out clearly enough from its background. This can make it difficult to read, especially for visitors with reduced vision.",
    why: "Shoppers who can't read a price, a button or a delivery note easily are less likely to buy, and many browse on a phone in bright light.",
    action:
      "Adjust the text or background colour in the affected sections so the text is easier to read. Check the actual text size and weight before choosing the required contrast.",
    validation:
      "Recheck the affected text on mobile and desktop, then rerun the contrast check. Review the rest of the page manually as well.",
  },
  {
    match: /button.*name/i,
    title: "Some buttons do not explain what they do",
    gain: "Every shopper, including people who use screen readers, can tell which button adds to cart.",
    meaning:
      "The automated check found buttons without an accessible name. People using a screen reader may not hear what those buttons do.",
    why: "A shopper using a screen reader hears only “button” and can't tell which one adds to cart or opens the menu.",
    action:
      "Give each affected button a clear visible label or an accessible name that describes its action.",
    validation:
      "Check the buttons with a screen reader and keyboard, then rerun the accessibility check.",
  },
  {
    match: /link.*name/i,
    title: "Some links do not explain where they lead",
    gain: "Every shopper can tell where a link goes, and Google understands your pages better.",
    meaning:
      "The automated check found links without a clear accessible name. People using a screen reader may not know their destination.",
    why: "Shoppers using a screen reader can't tell where these links go, and search engines learn less about your pages from them.",
    action:
      "Add descriptive link text or an accessible name to each affected link, including links that contain only an icon or image.",
    validation:
      "Check the affected links with a screen reader and keyboard, then rerun the accessibility check.",
  },
  {
    match: /unused javascript/i,
    title: "The page downloads code it doesn't use",
    gain: "Your pages respond sooner on a phone, so fewer shoppers give up before they see a product.",
    meaning:
      "The browser downloaded code that was not used during the tested page load. Some of that code may still be needed when a visitor interacts with the page.",
    why: "Every extra file makes a phone work harder before the page can be used, so shoppers wait longer and more of them give up.",
    action:
      "Review theme code and third-party apps. Delay optional features until they are needed, and remove unused code only after testing the affected features.",
    validation:
      "Repeat comparable mobile and desktop loading tests. Check navigation, the cart, consent controls and analytics still work correctly.",
  },
  {
    match: /unused css/i,
    title: "The page downloads styling it doesn't use",
    gain: "The first screen appears sooner, which is when shoppers decide whether to stay.",
    meaning:
      "The browser downloaded styling rules that were not used during the tested page load. Reviewing these files may reduce unnecessary downloads.",
    why: "Extra files slow the first view of the page, which is when shoppers decide whether to stay.",
    action:
      "Remove unused styling rules where safe, and load styles for optional features when needed. Check that changes do not alter the page layout.",
    validation:
      "Repeat the loading test and compare file sizes. Check the page appearance at mobile and desktop sizes.",
  },
  {
    match: /render.blocking/i,
    title: "Some files hold up the page appearing",
    gain: "Shoppers see your page sooner instead of a blank screen.",
    meaning:
      "A few files have to finish loading before the browser can show anything, so the page stays blank for longer.",
    why: "A blank screen is when shoppers give up, especially on mobile data.",
    action:
      "Load only what the first view needs straight away, and delay the rest. Test the change in a preview copy of the theme.",
    validation:
      "Repeat the loading test and check that the page still looks right while it loads.",
  },
  {
    match:
      /image delivery|optimized images|responsive images|properly size images/i,
    title: "Some images are bigger than they need to be",
    gain: "Product photos appear sooner and use less of a shopper's mobile data.",
    meaning:
      "The automated loading test found images that could use a smaller file size or a better size for the visitor’s screen.",
    why: "Large images are often the main reason a store feels slow on a phone, and the product photos are what shoppers came to see.",
    action:
      "Use appropriately sized images and suitable compression. Keep the main visible image loading promptly, and delay images further down the page until needed.",
    validation:
      "Compare image download sizes and loading time on the same device settings. Check that images remain sharp and the page layout stays stable.",
  },
  {
    match: /images without alt/i,
    title: "Some images are missing text descriptions",
    gain: "Your images can be found in Google Images and are described to shoppers who use screen readers.",
    meaning:
      "Some images have no short text description (alt text). Screen readers read this description aloud, and search engines use it to understand the image.",
    why: "Product images without descriptions are invisible to shoppers using screen readers and to Google Images, where people search for products.",
    action:
      "Add a short, accurate description to each product and content image. Decorative images can be marked as decorative instead.",
    validation:
      "Check the affected images in the page code or with a screen reader, then repeat the check.",
  },
  {
    match: /duplicate script/i,
    title: "The same code is loaded more than once",
    gain: "The page does each job once, so it loads more smoothly and features like reviews behave as expected.",
    meaning:
      "The page refers to the same script file more than once. This often happens when an app is installed twice or an old app leaves code behind.",
    why: "Code loaded twice can slow the page and sometimes makes features such as reviews or pop-ups behave strangely.",
    action:
      "Find which app or theme section adds each repeated script, and keep one copy. Remove leftovers from apps that are no longer used.",
    validation:
      "Check the page still works (cart, reviews, tracking), then confirm each script appears once.",
  },
  {
    match: /missing h1/i,
    title: "A page is missing its main heading",
    gain: "Google and shoppers can tell at a glance what the page is about.",
    meaning:
      "No main heading was found in the saved page HTML. A clear main heading helps visitors understand what the page is about.",
    why: "Google uses the main heading to understand what a page is about, so a missing one can make it harder to find you in search.",
    action:
      "Add a descriptive main heading and check that it fits the page’s heading structure.",
    validation:
      "Review the rendered page and its heading structure, then repeat the check.",
  },
  {
    match: /multiple h1/i,
    title: "A page has more than one main heading",
    gain: "Google and shoppers can tell at a glance what the page is about.",
    meaning:
      "The page has several main headings instead of one, so it's less clear what the page is mainly about.",
    why: "One clear main heading helps both shoppers and Google understand the page at a glance.",
    action:
      "Keep one main heading that names the page, and make the others sub-headings.",
    validation: "Review the page's headings, then repeat the check.",
  },
  {
    match: /missing meta description/i,
    title: "A page is missing its search description",
    gain: "You choose the sentence Google shows under your link, which helps more people click it.",
    meaning:
      "No page description was found in the saved HTML. This short summary can help explain the page when it appears in search results.",
    why: "Without one, Google picks its own text for your search result, which is often less convincing than yours would be.",
    action:
      "Write a short description for the page (about 150 characters) that says what you sell and why to choose you.",
    validation:
      "Check the page's description in its settings, then repeat the check.",
  },
  {
    match: /duplicate page title/i,
    title: "Several pages share the same title",
    gain: "Each page can show up on Google for its own search, instead of competing with your other pages.",
    meaning:
      "More than one page uses the same title, the text shown in the browser tab and as the headline in search results.",
    why: "When pages share a title, Google and shoppers can't tell them apart in search results.",
    action: "Give each page its own title that names what's on it.",
    validation:
      "Review the titles of the affected pages, then repeat the check.",
  },
  {
    match: /invalid json-ld/i,
    title: "Product details for Google contain an error",
    gain: "Google can show your price, stock and reviews right in search results.",
    meaning:
      "The page includes structured details for search engines (such as price and stock), but part of it can't be read because of an error.",
    why: "These details are how Google shows prices, ratings and stock in search results. With an error, it may show none.",
    action:
      "Fix the error in the structured data, usually added by the theme or an SEO or reviews app.",
    validation:
      "Test the page with Google's Rich Results Test, then repeat the check.",
  },
  {
    match: /noindex/i,
    title: "A page asks Google not to list it",
    gain: "The page can be found on Google again.",
    meaning:
      "The page tells search engines not to include it in their results. Sometimes that's on purpose; sometimes it's left over from building the site.",
    why: "If this page should be found, it won't appear in Google at all until this is changed.",
    action:
      "Check whether the page should be in search results. If it should, remove the setting that hides it.",
    validation: "Check the page's settings, then confirm it can be indexed.",
  },
  {
    match: /purchase control/i,
    title: "The add-to-cart button needs a check",
    gain: "Shoppers who want to buy can always reach the cart.",
    meaning:
      "The standard add-to-cart control wasn't found in the page as first loaded. It may still appear once the page finishes loading, so this needs checking by hand.",
    why: "If shoppers can't add to cart easily, nothing else matters.",
    action:
      "Try buying from the product page on a phone and a computer, and fix anything that gets in the way.",
    validation: "Complete a test purchase on mobile and desktop.",
  },
  {
    match: /image dimensions/i,
    title: "Image space needs a layout check",
    gain: "The page stops jumping around as it loads, so shoppers don't tap the wrong thing.",
    meaning:
      "Some images have no width or height in the saved HTML. The site’s styling may already reserve their space, so a visual check is needed before calling this a layout problem.",
    why: "If space isn't kept for images, the page jumps as they load, and shoppers tap the wrong thing.",
    action:
      "Give images a set size, or reserve their space in the theme's styling, so the page doesn't jump while loading.",
    validation:
      "Watch the page load on a phone and check nothing moves, then repeat the check.",
  },
];
/** What an issue costs the business, by area, when there's no specific line. */
const whyByCategory: [RegExp, string][] = [
  [
    /performance|frontend|images/i,
    "A slower page loses shoppers before they see your products, especially on phones.",
  ],
  [
    /accessibility/i,
    "Some shoppers find the store harder to use, and may leave without buying.",
  ],
  [/seo/i, "It can make it harder for people to find your store on Google."],
  [/cro/i, "It can get in the way of shoppers buying."],
];

const gainByCategory: [RegExp, string][] = [
  [
    /performance|frontend|images/i,
    "Pages appear sooner, so more shoppers stay to see your products.",
  ],
  [/accessibility/i, "More shoppers can use the store without getting stuck."],
  [/seo/i, "More people can find your store on Google."],
  [/cro/i, "Fewer shoppers get stuck on the way to buying."],
];

/** Summarize only recorded diagnostic nodes; never render their HTML snippets. */
export function explainFinding(
  issue: ReportIssue,
  findings: Finding[],
  samples: PsiSample[],
) {
  const template = copy.find((entry) => entry.match.test(issue.title));
  const examples: {
    text: string;
    measurement?: string;
    page: string;
    device: string;
  }[] = [];
  for (const finding of findings.filter((entry) =>
    issue.ids.includes(entry.id),
  )) {
    const device = finding.evidence.match(/^Lighthouse (mobile|desktop) /)?.[1];
    const sample = samples.find(
      (entry) =>
        entry.sample === 1 &&
        entry.strategy === device &&
        entry.url === finding.url,
    );
    const diagnostic = Object.values(sample?.diagnostics ?? {}).find(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        (entry as { title?: string }).title === finding.title,
    ) as { details?: unknown } | undefined;
    let details = diagnostic?.details;
    if (!details && device) {
      try {
        // Older saved evidence can end mid-JSON; partial values are not guessed.
        const start = finding.evidence.indexOf(": ");
        if (start >= 0) details = JSON.parse(finding.evidence.slice(start + 2));
      } catch {
        /* Full saved diagnostics, when available, are used instead. */
      }
    }
    let visited = 0;
    const visit = (value: unknown, depth = 0) => {
      if (++visited > 250 || depth > 8 || !value || typeof value !== "object")
        return;
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, depth + 1));
        return;
      }
      const node = value as Record<string, unknown>;
      if (typeof node.nodeLabel === "string" && node.nodeLabel.trim()) {
        const label = node.nodeLabel.replace(/\s+/g, " ").trim().slice(0, 160);
        const selector = /(?: > |^[a-z][\w-]*[.#]|^<[a-z])/i.test(label);
        const text = selector
          ? /link.*name/i.test(issue.title)
            ? "A link without a readable label"
            : /button.*name/i.test(issue.title)
              ? "A button without a readable label"
              : "A flagged page element"
          : label;
        const ratio =
          typeof node.explanation === "string"
            ? node.explanation.match(
                /(?:contrast ratio of|color contrast of)\s+([\d.]+)[\s\S]*?Expected contrast ratio of\s+([\d.]+)/i,
              )
            : null;
        const measurement = ratio
          ? `Recorded contrast ${ratio[1]}:1; required for this text ${ratio[2]}:1.`
          : undefined;
        if (
          examples.length < 12 &&
          !examples.some(
            (example) =>
              example.text === text &&
              example.measurement === measurement &&
              example.page === finding.url,
          )
        )
          examples.push({
            text,
            measurement,
            page: finding.url,
            device:
              device === "mobile"
                ? "Mobile"
                : device === "desktop"
                  ? "Desktop"
                  : "Page inspection",
          });
      }
      Object.values(node).forEach((item) => visit(item, depth + 1));
    };
    visit(details);
  }
  return {
    title: template?.title ?? issue.title,
    meaning: template?.meaning ?? issue.meaning,
    why:
      template?.why ??
      whyByCategory.find(([pattern]) => pattern.test(issue.category))?.[1] ??
      "Fixing it makes the store clearer and easier to use.",
    gain:
      template?.gain ??
      gainByCategory.find(([pattern]) => pattern.test(issue.category))?.[1] ??
      "The store gets clearer and easier to buy from.",
    action: template?.action ?? issue.action,
    validation: template?.validation ?? issue.validation,
    examples: examples
      .sort((a, b) => Number(!!b.measurement) - Number(!!a.measurement))
      .slice(0, 3),
  };
}
