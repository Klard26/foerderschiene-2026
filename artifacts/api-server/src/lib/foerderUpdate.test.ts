import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoerderProgramm } from "@workspace/db";
import {
  applyChanges,
  type ProgrammChange,
  type UpdateSource,
  validateChange,
} from "./foerderUpdate";

const dbState = vi.hoisted(() => ({
  updatePatches: [] as unknown[],
  insertValues: [] as unknown[],
  insertReturningRows: [] as Array<{ id: string }>,
}));

const db = vi.hoisted(() => ({
  update: vi.fn(() => ({
    set: vi.fn((patch: unknown) => {
      dbState.updatePatches.push(patch);
      return {
        where: vi.fn(async () => []),
      };
    }),
  })),
  insert: vi.fn(() => ({
    values: vi.fn((values: unknown) => {
      dbState.insertValues.push(values);
      return {
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(async () => dbState.insertReturningRows),
        })),
      };
    }),
  })),
}));

vi.mock("@workspace/db", () => ({
  db,
  foerderProgrammeTable: { id: "id" },
  foerderUpdateLogTable: { id: "id" },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn(() => "eq"),
    sql: vi.fn(() => "sql"),
  };
});

vi.mock("./anthropicClient", () => ({
  anthropic: { messages: { create: vi.fn() } },
}));

vi.mock("./foerderschiene", () => ({
  ensureProgrammeSeeded: vi.fn(),
}));

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const source: UpdateSource = {
  quelle: "kfw",
  foerdergeberPrefix: "KfW",
  url: "https://www.kfw.de/inlandsfoerderung/",
};

function change(overrides: Partial<ProgrammChange> = {}): ProgrammChange {
  return {
    titel: "Energieeffizienzprogramm",
    status: "aktiv",
    ...overrides,
  };
}

function existing(
  overrides: Partial<FoerderProgramm> = {},
): FoerderProgramm {
  return {
    id: "kfw-bestand",
    titel: "Energieeffizienzprogramm",
    foerdergeber: "KfW",
    ebene: "bund",
    art: "zuschuss",
    timing: "vor_vorhabenbeginn",
    foerderquoteText: "20 %",
    quoteMax: null,
    maxBetragText: "20.000 €",
    maxBetragEur: 20_000,
    kurzbeschreibung: "Bestehendes Förderprogramm",
    besonderheit: null,
    quelleUrl: source.url,
    erfolgsquote: null,
    tags: ["daemmung"],
    region: "bundesweit",
    aktiv: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  dbState.updatePatches.length = 0;
  dbState.insertValues.length = 0;
  dbState.insertReturningRows = [];
  vi.clearAllMocks();
});

describe("validateChange", () => {
  it("rejects missing titles and invalid status enums", () => {
    expect(validateChange({ status: "aktiv" }, source)).toBeNull();
    expect(
      validateChange({ titel: "Programm", status: "unknown" }, source),
    ).toBeNull();
  });

  it("rejects overlong titles and drops overlong optional text", () => {
    expect(
      validateChange(
        { titel: "x".repeat(201), status: "aktiv" },
        source,
      ),
    ).toBeNull();

    const parsed = validateChange(
      {
        titel: "Programm",
        status: "aktiv",
        foerderquoteText: "x".repeat(501),
        kurzbeschreibung: "Kurz genug",
        begruendung: "x".repeat(301),
      },
      source,
    );

    expect(parsed).toMatchObject({
      titel: "Programm",
      kurzbeschreibung: "Kurz genug",
    });
    expect(parsed?.foerderquoteText).toBeUndefined();
    expect(parsed?.begruendung).toBeUndefined();
  });

  it("drops foreign or non-HTTPS source URLs", () => {
    const foreign = validateChange(
      {
        titel: "Programm",
        status: "aktiv",
        quelleUrl: "https://example.com/attacker",
      },
      source,
    );
    const nonHttps = validateChange(
      {
        titel: "Programm",
        status: "aktiv",
        quelleUrl: "http://www.kfw.de/program",
      },
      source,
    );

    expect(foreign?.quelleUrl).toBeUndefined();
    expect(nonHttps?.quelleUrl).toBeUndefined();
  });

  it("drops invalid art and tags while retaining allowed enum values", () => {
    const parsed = validateChange(
      {
        titel: "Programm",
        status: "aktiv",
        art: "delete-all-programmes",
        tags: ["daemmung", "inject", "pv"],
      },
      source,
    );

    expect(parsed?.art).toBeUndefined();
    expect(parsed?.tags).toEqual(["daemmung", "pv"]);
  });

  it("accepts bounded numeric values and rejects unsafe ones", () => {
    expect(
      validateChange(
        { titel: "Programm", status: "aktiv", maxBetragEur: 1234.6 },
        source,
      )?.maxBetragEur,
    ).toBe(1235);
    expect(
      validateChange(
        { titel: "Programm", status: "aktiv", maxBetragEur: 10_000_001 },
        source,
      )?.maxBetragEur,
    ).toBeUndefined();
    expect(
      validateChange(
        { titel: "Programm", status: "aktiv", maxBetragEur: null },
        source,
      )?.maxBetragEur,
    ).toBeNull();
  });
});

describe("applyChanges", () => {
  it("caps mass deactivation at two programmes per source", async () => {
    const programmes = Array.from({ length: 10 }, (_, index) =>
      existing({
        id: `kfw-${index}`,
        titel: `Programm ${index}`,
      }),
    );
    const changes = programmes.map((programme) =>
      change({ id: programme.id, titel: programme.titel, status: "abgelaufen" }),
    );

    await expect(applyChanges(source, changes, programmes)).resolves.toEqual({
      eingefuegt: 0,
      geaendert: 0,
      deaktiviert: 2,
    });
    expect(dbState.updatePatches).toEqual([{ aktiv: false }, { aktiv: false }]);
  });

  it("does not reactivate an inactive programme", async () => {
    const inactive = existing({ aktiv: false });

    await expect(
      applyChanges(
        source,
        [
          change({
            id: inactive.id,
            titel: inactive.titel,
            status: "aktiv",
            foerderquoteText: "30 %",
          }),
        ],
        [inactive],
      ),
    ).resolves.toEqual({ eingefuegt: 0, geaendert: 1, deaktiviert: 0 });
    expect(dbState.updatePatches).toEqual([{ foerderquoteText: "30 %" }]);
    expect(dbState.updatePatches[0]).not.toHaveProperty("aktiv", true);
  });

  it("does not insert a new programme without both required text fields", async () => {
    const missingDescription = change({ foerderquoteText: "20 %" });
    const missingRate = change({ kurzbeschreibung: "Beschreibung" });

    await applyChanges(source, [missingDescription, missingRate], []);

    expect(db.insert).not.toHaveBeenCalled();
    expect(dbState.insertValues).toHaveLength(0);
  });

  it("counts only actual inserts when ON CONFLICT does nothing", async () => {
    dbState.insertReturningRows = [];
    const newChange = change({
      titel: "Neues KfW-Programm",
      kurzbeschreibung: "Beschreibung",
      foerderquoteText: "25 %",
    });

    await expect(applyChanges(source, [newChange], [])).resolves.toEqual({
      eingefuegt: 0,
      geaendert: 0,
      deaktiviert: 0,
    });

    dbState.insertReturningRows = [{ id: "kfw-neues-kfw-programm" }];
    await expect(applyChanges(source, [newChange], [])).resolves.toEqual({
      eingefuegt: 1,
      geaendert: 0,
      deaktiviert: 0,
    });
    expect(dbState.insertValues).toHaveLength(2);
  });

  it("caps unchecked change lists at eight updates", async () => {
    const programmes = Array.from({ length: 9 }, (_, index) =>
      existing({
        id: `kfw-${index}`,
        titel: `Programm ${index}`,
      }),
    );
    const changes = programmes.map((programme) =>
      change({
        id: programme.id,
        titel: programme.titel,
        status: "aktiv",
        kurzbeschreibung: `Neue Beschreibung ${programme.id}`,
      }),
    );

    await expect(applyChanges(source, changes, programmes)).resolves.toEqual({
      eingefuegt: 0,
      geaendert: 8,
      deaktiviert: 0,
    });
    expect(dbState.updatePatches).toHaveLength(8);
  });
});