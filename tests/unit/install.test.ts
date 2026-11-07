import { describe, expect, it } from "vitest";
import { deriveInstall, parseManifestNames, tomlSectionValue, urlPointsToRepo } from "@/lib/install";

const base = { repoId: "acme/tool", files: [] as string[], contents: {} };

describe("deriveInstall", () => {
  it("uses npm with verified registry name", () => {
    const r = deriveInstall({ ...base, files: ["package.json"], contents: { "package.json": '{"name":"acme-tool"}' }, verified: { npm: true } });
    expect(r).toEqual({ manager: "npm", command: "npm install acme-tool", manifest: "package.json", verified: true });
  });

  it("installs CLIs globally when package.json has bin", () => {
    const r = deriveInstall({ ...base, files: ["package.json"], contents: { "package.json": '{"name":"@acme/cli","bin":{"acme":"x.js"}}' }, verified: { npm: true } });
    expect(r?.command).toBe("npm install -g @acme/cli");
  });

  it("falls back to github: source when the npm name is not verified", () => {
    const r = deriveInstall({ ...base, files: ["package.json"], contents: { "package.json": '{"name":"react"}' }, verified: { npm: false } });
    expect(r?.command).toBe("npm install github:acme/tool");
    expect(r?.verified).toBe(false);
  });

  it("skips private package.json and continues with the next manifest", () => {
    const r = deriveInstall({
      ...base,
      files: ["package.json", "Dockerfile"],
      contents: { "package.json": '{"name":"monorepo","private":true}' },
    });
    expect(r?.manager).toBe("docker");
    expect(r?.command).toBe("docker build -t tool https://github.com/acme/tool.git");
  });

  it("rejects shell metacharacters in untrusted names", () => {
    const evil = deriveInstall({ ...base, files: ["package.json"], contents: { "package.json": '{"name":"x; rm -rf ~"}' }, verified: { npm: true } });
    expect(evil?.command).toBe("npm install github:acme/tool");
    const evilPy = deriveInstall({ ...base, files: ["pyproject.toml"], contents: { "pyproject.toml": '[project]\nname = "a$(curl x)"' }, verified: { pypi: true } });
    expect(evilPy?.command).toBe("pip install git+https://github.com/acme/tool.git");
    const evilGo = deriveInstall({ ...base, files: ["go.mod"], contents: { "go.mod": "module github.com/a/b;echo\n" } });
    expect(evilGo).toBeNull();
  });

  it("derives pip from pyproject.toml ([project] and poetry)", () => {
    expect(deriveInstall({ ...base, files: ["pyproject.toml"], contents: { "pyproject.toml": '[build-system]\nrequires=[]\n[project]\nname = "fastthing"\n' }, verified: { pypi: true } })?.command).toBe("pip install fastthing");
    expect(deriveInstall({ ...base, files: ["pyproject.toml"], contents: { "pyproject.toml": '[tool.poetry]\nname = "poetic"\n' }, verified: { pypi: true } })?.command).toBe("pip install poetic");
  });

  it("derives cargo install for binaries and cargo add for libraries", () => {
    const toml = '[package]\nname = "ripper"\nversion = "1.0.0"\n';
    expect(deriveInstall({ ...base, files: ["Cargo.toml"], contents: { "Cargo.toml": toml }, hasMainRs: true, verified: { crates: true } })?.command).toBe("cargo install ripper");
    expect(deriveInstall({ ...base, files: ["Cargo.toml"], contents: { "Cargo.toml": toml }, verified: { crates: true } })?.command).toBe("cargo add ripper");
    expect(deriveInstall({ ...base, files: ["Cargo.toml"], contents: { "Cargo.toml": "[workspace]\nmembers = []\n" } })?.command).toBe("cargo install --git https://github.com/acme/tool");
  });

  it("derives go install / go get from go.mod", () => {
    const contents = { "go.mod": "module github.com/acme/tool\n\ngo 1.22\n" };
    expect(deriveInstall({ ...base, files: ["go.mod", "main.go"], contents })?.command).toBe("go install github.com/acme/tool@latest");
    expect(deriveInstall({ ...base, files: ["go.mod", "cmd"], contents })?.command).toBe("go install github.com/acme/tool/cmd/...@latest");
    expect(deriveInstall({ ...base, files: ["go.mod"], contents })?.command).toBe("go get github.com/acme/tool@latest");
  });

  it("ignores manifests that don't match the primary language", () => {
    const r = deriveInstall({
      ...base,
      language: "JavaScript",
      files: ["Cargo.toml", "package.json"],
      contents: { "Cargo.toml": '[workspace]\nmembers=[]', "package.json": '{"name":"mono","private":true}' },
    });
    expect(r).toBeNull();
    const py = deriveInstall({ ...base, language: "C++", files: ["pyproject.toml", "Dockerfile"], contents: { "pyproject.toml": '[project]\nname="tools"' } });
    expect(py?.manager).toBe("docker");
  });

  it("uses crates.io bin info when available", () => {
    const toml = '[package]\nname = "bat"\n';
    expect(deriveInstall({ ...base, language: "Rust", files: ["Cargo.toml"], contents: { "Cargo.toml": toml }, verified: { crates: true, crateHasBin: true } })?.command).toBe("cargo install bat");
  });

  it("returns null when nothing is derivable", () => {
    expect(deriveInstall({ ...base, files: ["README.md", "LICENSE"] })).toBeNull();
  });
});

describe("helpers", () => {
  it("parses toml sections only within the right section", () => {
    expect(tomlSectionValue('[tool.other]\nname = "no"\n[project]\nname = "yes"', "project", "name")).toBe("yes");
  });
  it("parses setup.py names", () => {
    expect(parseManifestNames({ ...base, contents: { "setup.py": "setup(name='legacy', version='1')" } }).setupPyName).toBe("legacy");
  });
  it("matches registry repository urls", () => {
    expect(urlPointsToRepo("git+https://github.com/Acme/Tool.git", "acme/tool")).toBe(true);
    expect(urlPointsToRepo("git@github.com:acme/tool.git", "acme/tool")).toBe(true);
    expect(urlPointsToRepo("https://github.com/acme/tool/tree/main/packages/x", "acme/tool")).toBe(true);
    expect(urlPointsToRepo("git+https://acme@github.com/acme/tool.git", "acme/tool")).toBe(true);
    expect(urlPointsToRepo("https://github.com/evil/tool", "acme/tool")).toBe(false);
    expect(urlPointsToRepo("https://github.com/acme/tool-fork", "acme/tool")).toBe(false);
  });
});
