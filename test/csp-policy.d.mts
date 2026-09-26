/**
 * Type declarations for the CSP analyser helpers, which the repository runs as
 * plain `.mjs` so `node test/csp-check.mjs` needs no build step.
 */
export declare function parseCsp(csp: unknown): Map<string, string[]>;
export declare function hostSourceAllows(source: string, url: string): boolean;
export declare function directiveAllows(
  directiveName: string,
  sources: string[] | undefined,
  url: string,
): { allowed: boolean; reason: string };
export declare function extractNetworkUrls(html: string): Array<{ kind: string; url: string }>;
export declare function extractResourceUrls(html: string): Array<{ kind: string; url: string }>;

// Fixture expectations and the gate's verdict (see csp-check.mjs).
export type FixtureExpectation = "allowed" | "blocked";
export declare const EXPECT_ALLOWED: "allowed";
export declare const EXPECT_BLOCKED: "blocked";
export declare function readFixtureExpectation(html: string): FixtureExpectation;
export interface CspFinding {
  directive: string;
  url: string;
  reason: string;
}
export interface SandboxFinding {
  api: string;
  reason: string;
}
export interface FixtureAnalysis {
  blocked?: CspFinding[];
  allowed?: CspFinding[];
  sandboxed?: SandboxFinding[];
}
export interface FixtureVerdict {
  status: "pass" | "warn" | "fail";
  problems: string[];
  blocked: CspFinding[];
  allowed: CspFinding[];
  sandboxed: SandboxFinding[];
}
export declare function dedupeFindings(findings: CspFinding[]): CspFinding[];
export declare function classifyFixture(
  expectation: FixtureExpectation,
  analysis: FixtureAnalysis,
): FixtureVerdict;
