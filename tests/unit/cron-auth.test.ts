import { describe, expect, it } from "vitest";
import { isAuthorizedCron } from "@/server/security/cron-auth";

const SECRET = "x".repeat(40);

describe("isAuthorizedCron", () => {
  it("принимает точный Bearer-секрет", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });
  it("отклоняет неверный, пустой и чужой формат", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}y`, SECRET)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET.slice(1)}`, SECRET)).toBe(false);
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
    expect(isAuthorizedCron("", SECRET)).toBe(false);
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCron(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(isAuthorizedCron(`Bearer  ${SECRET}`, SECRET)).toBe(false);
  });
  it("без настроенного или слишком короткого секрета доступ закрыт", () => {
    expect(isAuthorizedCron("Bearer anything", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer short", "short")).toBe(false);
  });
});
