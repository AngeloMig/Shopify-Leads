import { describe, expect, it } from "vitest";
import { checkMailDomains, mailDomainStatus } from "../server/lib/mail-domain";

const failure = (code: string) => Object.assign(new Error(code), { code });
const fails = (code: string) => async () => {
  throw failure(code);
};
const dns = (over = {}) =>
  ({
    resolveMx: fails("ENODATA"),
    resolve4: fails("ENODATA"),
    resolve6: fails("ENODATA"),
    ...over,
  }) as never;

describe("mailDomainStatus", () => {
  it("accepts a domain with a mail server", async () => {
    const resolveMx = async () => [
      { exchange: "mx.shop.example", priority: 1 },
    ];
    expect(await mailDomainStatus("shop.example", dns({ resolveMx }))).toBe(
      "ok",
    );
  });
  it("treats a null MX record as refusing mail", async () => {
    const resolveMx = async () => [{ exchange: "", priority: 0 }];
    expect(
      await mailDomainStatus(
        "shop.example",
        dns({ resolveMx, resolve4: async () => ["192.0.2.1"] }),
      ),
    ).toBe("none");
  });
  it("falls back to the domain's own address when there is no MX", async () => {
    expect(
      await mailDomainStatus(
        "shop.example",
        dns({ resolve6: async () => ["2001:db8::1"] }),
      ),
    ).toBe("ok");
  });
  it("reports none only when the domain has no records", async () => {
    expect(await mailDomainStatus("shop.example", dns())).toBe("none");
    expect(
      await mailDomainStatus(
        "gone.example",
        dns({
          resolveMx: fails("ENOTFOUND"),
          resolve4: fails("ENOTFOUND"),
          resolve6: fails("ENOTFOUND"),
        }),
      ),
    ).toBe("none");
  });
  it("keeps a failed lookup unknown", async () => {
    expect(
      await mailDomainStatus(
        "a.example",
        dns({ resolveMx: fails("ETIMEOUT") }),
      ),
    ).toBe("unknown");
    expect(
      await mailDomainStatus(
        "a.example",
        dns({ resolve4: fails("ESERVFAIL") }),
      ),
    ).toBe("unknown");
  });
});
describe("checkMailDomains", () => {
  it("looks each domain up once, in lowercase", async () => {
    const looked: string[] = [];
    const resolveMx = async (domain: string) => {
      looked.push(domain);
      return [{ exchange: "mx", priority: 1 }];
    };
    expect(
      await checkMailDomains(
        [{ email: "a@Shop.example" }, { email: "b@shop.example" }],
        dns({ resolveMx }),
      ),
    ).toEqual({ "shop.example": "ok" });
    expect(looked).toEqual(["shop.example"]);
  });
});
