import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The header needs the shell's navigation drawer; the note under it is what these tests read.
vi.mock("@/components/PageHeader", () => ({ PageHeader: () => null }));

const { ApiPage } = await import("@/components/ApiPage");

describe("System → API", () => {
  it("explains demo_locked in demo mode", () => {
    const html = renderToStaticMarkup(createElement(ApiPage, { demo: true }));
    expect(html).toContain('data-testid="api-demo-note"');
    expect(html).toContain("demo_locked");
  });

  it("says nothing about the demo otherwise", () => {
    const html = renderToStaticMarkup(createElement(ApiPage, { demo: false }));
    expect(html).not.toContain("api-demo-note");
    expect(html).not.toContain("demo_locked");
  });
});
