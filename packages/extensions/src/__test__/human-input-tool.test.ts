import { describe, expect, it, vi } from "vitest";

import {
  createHumanInputTool,
  HUMAN_INPUT_TOOL_NAME,
  readHumanInputRequest,
} from "../human/human-input-tool";

describe("createHumanInputTool", () => {
  it("normalizes structured human input requests and returns answers", async () => {
    const request = vi.fn(async () => ({
      answers: [
        {
          id: "scope",
          header: "Scope",
          question: "Which scope should StoryForge use?",
          type: "single_select" as const,
          selectedOptionIds: ["minimal"],
          selectedLabels: ["Minimal"],
        },
      ],
      remark: " Keep it narrow. ",
    }));
    const tool = createHumanInputTool({ request });

    const output = await tool.execute({
      title: " Choose implementation scope ",
      description: " Need a product decision. ",
      questions: [
        {
          id: "scope",
          header: " Scope ",
          question: " Which scope should StoryForge use? ",
          type: "single_select",
          options: [
            { id: "minimal", label: " Minimal ", description: " Touch the narrowest surface. " },
            { id: "full", label: " Full" },
          ],
          required: true,
        },
        {
          id: "targets",
          header: "Targets",
          question: "Which targets should be included?",
          type: "multi_select",
          options: [
            { id: "types", label: "Types" },
            { id: "tests", label: "Tests" },
          ],
          allowOther: true,
        },
        {
          id: "note",
          header: "Note",
          question: "Any extra constraints?",
          type: "text",
        },
      ],
      remark: {
        enabled: true,
        label: " Additional context ",
        placeholder: " Optional constraints ",
      },
    }, {});

    expect(tool.name).toBe(HUMAN_INPUT_TOOL_NAME);
    expect(request).toHaveBeenCalledWith({
      title: "Choose implementation scope",
      description: "Need a product decision.",
      questions: [
        {
          id: "scope",
          header: "Scope",
          question: "Which scope should StoryForge use?",
          type: "single_select",
          options: [
            { id: "minimal", label: "Minimal", description: "Touch the narrowest surface." },
            { id: "full", label: "Full" },
          ],
          required: true,
        },
        {
          id: "targets",
          header: "Targets",
          question: "Which targets should be included?",
          type: "multi_select",
          options: [
            { id: "types", label: "Types" },
            { id: "tests", label: "Tests" },
          ],
          allowOther: true,
        },
        {
          id: "note",
          header: "Note",
          question: "Any extra constraints?",
          type: "text",
        },
      ],
      remark: {
        enabled: true,
        label: "Additional context",
        placeholder: "Optional constraints",
      },
    }, {});
    expect(output).toEqual({
      cancelled: false,
      answers: [
        {
          id: "scope",
          header: "Scope",
          question: "Which scope should StoryForge use?",
          type: "single_select",
          selectedOptionIds: ["minimal"],
          selectedLabels: ["Minimal"],
        },
      ],
      remark: "Keep it narrow.",
    });
  });

  it("returns a cancelled result when the host response is cancelled", async () => {
    const tool = createHumanInputTool({
      request: async () => ({ cancelled: true }),
    });

    await expect(tool.execute(validInput(), {})).resolves.toEqual({
      cancelled: true,
      reason: "cancelled",
      message: "User cancelled the human input request.",
    });
  });

  it("does not call the host when the turn is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn(async () => ({ answers: [] }));
    const tool = createHumanInputTool({ request });

    await expect(tool.execute(validInput(), { signal: controller.signal })).resolves.toEqual({
      cancelled: true,
      reason: "aborted",
      message: "Human input request was cancelled because the turn stopped.",
    });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("readHumanInputRequest", () => {
  it("rejects select questions without options before calling the host", () => {
    expect(() =>
      readHumanInputRequest({
        title: "Choose scope",
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "Which scope?",
            type: "single_select",
          },
        ],
      })
    ).toThrow("ask_user single_select question 1 requires options");
  });

  it("rejects text questions with options", () => {
    expect(() =>
      readHumanInputRequest({
        title: "Add note",
        questions: [
          {
            id: "note",
            header: "Note",
            question: "Any extra context?",
            type: "text",
            options: [
              { id: "yes", label: "Yes" },
              { id: "no", label: "No" },
            ],
          },
        ],
      })
    ).toThrow("ask_user text question 1 must not include options");
  });

  it("rejects duplicate question ids", () => {
    expect(() =>
      readHumanInputRequest({
        title: "Choose",
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "Which scope?",
            type: "text",
          },
          {
            id: "scope",
            header: "Again",
            question: "Which scope again?",
            type: "text",
          },
        ],
      })
    ).toThrow("ask_user question 2 id must be unique");
  });
});

function validInput(): Record<string, unknown> {
  return {
    title: "Choose implementation scope",
    questions: [
      {
        id: "scope",
        header: "Scope",
        question: "Which scope should StoryForge use?",
        type: "single_select",
        options: [
          { id: "minimal", label: "Minimal" },
          { id: "full", label: "Full" },
        ],
      },
    ],
  };
}
