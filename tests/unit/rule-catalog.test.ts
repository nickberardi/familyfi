import { describe, expect, it } from "vitest";
import { catalogCopy, catalogFamiliar, catalogMatches, searchCatalog } from "@/lib/rule-catalog";
import { CURATED_CATEGORY_SLOTS } from "@/lib/rules";

const video = CURATED_CATEGORY_SLOTS.find((item) => item.slot === "video")!;

describe("the rule catalog", () => {
  it("asks the gateway's catalog, filtered when there is a search", async () => {
    const asked: string[] = [];
    const request = async <T,>(path: string) => {
      asked.push(path);
      return (path.includes("applications") ? { applications: [{ id: 1, name: "Chat" }] } : {}) as T;
    };
    expect(await searchCatalog(request, "app", "chat & more")).toEqual([{ id: 1, name: "Chat" }]);
    expect(await searchCatalog(request, "category", "")).toEqual([]);
    expect(asked).toEqual(["/api/v1/dpi/applications?filter=chat%20%26%20more", "/api/v1/dpi/categories"]);
  });

  it("matches a category's familiar name first, then the catalog's answers, never twice or once picked", () => {
    expect(catalogFamiliar("category", " VID ")).toEqual([{ id: video.categoryId, name: video.catalogName }]);
    expect(catalogFamiliar("app", "vid")).toEqual([]);
    expect(catalogFamiliar("category", "  ")).toEqual([]);
    const found = [
      { id: video.categoryId, name: video.catalogName },
      { id: 900, name: "Video conferencing" },
      { id: 901, name: "Video games" },
    ];
    expect(catalogMatches("category", "vid", found, [901]).map((item) => item.id)).toEqual([video.categoryId, 900]);
    expect(catalogMatches("category", "vid", found, [video.categoryId, 900, 901])).toEqual([]);
    expect(catalogMatches("app", "vid", found, []).map((item) => item.id)).toEqual([video.categoryId, 900, 901]);
  });

  it("names the search by what it finds", () => {
    expect(catalogCopy("app")).toMatchObject({ search: "Search apps", matches: "Matching apps" });
    expect(catalogCopy("category").none("x")).toBe("No categories match “x”.");
  });
});
