import { describe, it, expect } from "vitest";
import {
  domainCandidates,
  guessSite,
  pageIsTheirs,
} from "../server/modules/domain-guess";
import {
  readGeoapifyPlace,
  inTrade,
  localTrade,
} from "../shared/local-business";

const page = (title: string, body: string) =>
  `<html><head><title>${title}</title></head><body>${body}</body></html>`;
const menzies = {
  name: "A. Menzies and Sons",
  phone: "+44 141 945 1127",
  city: "Glasgow",
};

describe("Guessing a business's own domain", () => {
  it("tries the name with the country's endings, most likely first", () => {
    expect(domainCandidates("A. Menzies and Sons", "GB")).toEqual([
      "menziesandsons.co.uk",
      "menziesandsons.com",
      "menziessons.co.uk",
      "menziessons.com",
    ]);
    expect(domainCandidates("Harbor Roofing LLC", "US")).toEqual([
      "harborroofing.com",
      "harbor.com",
    ]);
  });
  it("takes a page as theirs only when it shows their name and phone", () => {
    const theirs = page(
      "Menzies & Sons Roofing Glasgow",
      "<p>A. Menzies and Sons, call 0141 945 1127</p>",
    );
    expect(pageIsTheirs(theirs, menzies)).toBe(true);
    const namesake = page(
      "Menzies Aviation",
      "<p>Menzies and sons of aviation. Call 0800 111 2222</p>",
    );
    expect(pageIsTheirs(namesake, menzies)).toBe(false);
    const telLink = page(
      "Menzies and Sons",
      '<a href="tel:+441419451127">Call us</a>',
    );
    expect(pageIsTheirs(telLink, menzies)).toBe(true);
  });
  it("with no phone listed, needs the city and the name in the title", () => {
    const b = { ...menzies, phone: null };
    expect(
      pageIsTheirs(page("Menzies and Sons", "Roofers in Glasgow"), b),
    ).toBe(true);
    expect(pageIsTheirs(page("Home", "Menzies and Sons in Glasgow"), b)).toBe(
      false,
    );
  });
  it("returns the first domain that is theirs, and none when lookups fail", async () => {
    const tried: string[] = [];
    const found = await guessSite(menzies, "GB", async (url) => {
      tried.push(url);
      if (!url.includes("menziesandsons.com")) throw new Error("ENOTFOUND");
      return {
        url,
        status: 200,
        headers: { "content-type": "text/html" },
        body: Buffer.from(page("Menzies and Sons", "Call 0141 945 1127")),
      };
    });
    expect(found).toBe("menziesandsons.com");
    expect(tried).toHaveLength(4);
    expect(
      await guessSite(menzies, "GB", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).toBeNull();
  });
});

describe("What a map listing's website really is", () => {
  it("keeps a Facebook page as a social link, not a website", () => {
    const p = readGeoapifyPlace({
      properties: {
        place_id: "51a",
        name: "Ridgeway Builders",
        website: "https://www.facebook.com/ridgewaybuilders",
      },
    })!;
    expect(p.website).toBeNull();
    expect(p.social_links).toEqual([
      { network: "facebook", url: "https://www.facebook.com/ridgewaybuilders" },
    ]);
  });
  it("treats a link-in-bio page as no website", () => {
    const p = readGeoapifyPlace({
      properties: {
        place_id: "51b",
        name: "Ridgeway Builders",
        website: "https://linktr.ee/ridgeway",
      },
    })!;
    expect(p.website).toBeNull();
  });
  it("skips builders' merchants for construction", () => {
    const p = readGeoapifyPlace({
      properties: {
        place_id: "51c",
        name: "KBS Builders Merchants",
        categories: ["office", "office.company"],
        datasource: { raw: { office: "construction_company" } },
      },
    })!;
    expect(inTrade(localTrade("construction")!, p)).toBe(false);
  });
});
