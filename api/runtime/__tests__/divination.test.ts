import { describe, expect, it } from "vitest";
import { isValidKey } from "../memory/keys";
import {
  decideArchiveAction,
  formatReadingArchive,
  parseDrawnSpread,
  uniqueReadingKey,
  type DrawnSpread,
  type PendingReading,
} from "../divination";

const three: DrawnSpread = {
  question: "今晚去不去酒馆",
  spread: "三张",
  cards: [
    { name: "愚者", reversed: true },
    { name: "星星", reversed: false },
  ],
};

const pending: PendingReading = {
  ...three,
  interpretation: "先停一停，再跟灯走。",
};

describe("formatReadingArchive", () => {
  it("files cards, interpretation, and feedback in one line", () => {
    expect(
      formatReadingArchive({
        ...pending,
        feedback: "挺准的，今晚不去了",
      }),
    ).toBe(
      "问：今晚去不去酒馆｜牌：愚者(逆)、星星(正)｜阵：三张｜解读：先停一停，再跟灯走。｜反馈：挺准的，今晚不去了",
    );
  });

  it("marks missing feedback instead of dropping the field", () => {
    expect(formatReadingArchive({ ...pending, feedback: null })).toContain("反馈：尚未开口");
  });
});

describe("uniqueReadingKey", () => {
  it("is a valid memory key and changes with the seed", () => {
    const a = uniqueReadingKey("愚者", 1_700_000_000_000);
    const b = uniqueReadingKey("星星", 1_700_000_000_000);
    expect(isValidKey(a)).toBe(true);
    expect(isValidKey(b)).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("parseDrawnSpread", () => {
  it("reads a draw_tarot payload", () => {
    expect(
      parseDrawnSpread({
        spread: "单张",
        question: "问一事",
        cards: [{ name: "月亮", reversed: true, arcana: "大阿卡纳" }],
      }),
    ).toEqual({
      spread: "单张",
      question: "问一事",
      cards: [{ name: "月亮", reversed: true }],
    });
  });

  it("rejects a failed or empty draw", () => {
    expect(parseDrawnSpread({ error: "invalid_arguments" })).toBeNull();
    expect(parseDrawnSpread({ cards: [] })).toBeNull();
  });
});

describe("decideArchiveAction", () => {
  it("ignores every other kind", () => {
    expect(
      decideArchiveAction({
        kind: "diet",
        drew: three,
        loggedThisTurn: false,
        pending: null,
        userMessage: "抽一张",
        interpretation: "…",
      }),
    ).toEqual({ action: "noop" });
  });

  it("lets log_reading win on the same turn", () => {
    expect(
      decideArchiveAction({
        kind: "divination",
        drew: three,
        loggedThisTurn: true,
        pending: pending,
        userMessage: "准",
        interpretation: "…",
      }),
    ).toEqual({ action: "clear" });
  });

  it("stashes the draw and interpretation until the visitor reacts", () => {
    const decision = decideArchiveAction({
      kind: "divination",
      drew: three,
      loggedThisTurn: false,
      pending: null,
      userMessage: "帮我抽三张",
      interpretation: "先停一停，再跟灯走。",
    });
    expect(decision).toEqual({
      action: "stash",
      pending: { ...three, interpretation: "先停一停，再跟灯走。" },
    });
  });

  it("archives the pending reading when the next line is feedback", () => {
    const decision = decideArchiveAction({
      kind: "divination",
      drew: null,
      loggedThisTurn: false,
      pending,
      userMessage: "挺准的，今晚不去了",
      interpretation: "（本轮没有新解读）",
    });
    expect(decision).toEqual({
      action: "archive",
      archive: { ...pending, feedback: "挺准的，今晚不去了" },
      stash: null,
    });
  });

  it("files the last reading before stashing a new draw", () => {
    const next: DrawnSpread = {
      question: "工作",
      spread: "单张",
      cards: [{ name: "隐者", reversed: false }],
    };
    const decision = decideArchiveAction({
      kind: "divination",
      drew: next,
      loggedThisTurn: false,
      pending,
      userMessage: "再抽一张问工作",
      interpretation: "今晚适合收一收。",
    });
    expect(decision.action).toBe("archive");
    if (decision.action !== "archive") return;
    expect(decision.archive.feedback).toBe("再抽一张问工作");
    expect(decision.stash?.cards[0]?.name).toBe("隐者");
  });
});
