import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPostgresSslOptions } from "~/lib/db.server";

const previousCaPath = process.env.DATABASE_CA_CERT_PATH;
let tempDir: string | undefined;

afterEach(async () => {
  if (previousCaPath === undefined) delete process.env.DATABASE_CA_CERT_PATH;
  else process.env.DATABASE_CA_CERT_PATH = previousCaPath;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("PostgreSQL TLS options", () => {
  it("does not enable TLS for local database URLs", () => {
    expect(getPostgresSslOptions("postgres://localhost/html_docs_dev")).toBe(false);
    expect(getPostgresSslOptions("postgres://127.0.0.1:5432/html_docs_dev")).toBe(false);
  });

  it("requires certificate verification for remote database URLs", () => {
    expect(getPostgresSslOptions("postgres://db.example.test/html_docs")).toEqual({
      rejectUnauthorized: true,
    });
  });

  it("uses an explicitly configured CA certificate", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "html-docs-db-ssl-"));
    const caPath = path.join(tempDir, "ca.pem");
    await writeFile(caPath, "-----BEGIN CERTIFICATE-----\\ntest\\n-----END CERTIFICATE-----\\n");

    process.env.DATABASE_CA_CERT_PATH = caPath;
    expect(getPostgresSslOptions("postgres://db.example.test/html_docs")).toEqual({
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----\\ntest\\n-----END CERTIFICATE-----\\n",
    });
  });
});
