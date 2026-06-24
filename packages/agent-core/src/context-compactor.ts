import type { AssistantChatMessage, ChatMessage } from "@story-forge/model-gateway";
import type { SessionTask } from "@story-forge/shared";

export type CompactionSummarize = (request: {
  messages: ChatMessage[];
}) => Promise<string>;

export type CompactionInput = {
  messages: ChatMessage[];
  openTasks: SessionTask[];
  retainRounds: number;
  summarize: CompactionSummarize;
};

export type CompactionResult = {
  messages: ChatMessage[];
  summaryText: string;
  retainedRounds: number;
  compacted: boolean;
};

const SUMMARY_INSTRUCTION_HEADER =
  "你正在对一段较长的对话进行上下文压缩。请把下面的对话历史浓缩成一份自包含的中文摘要，" +
  "这份摘要将替换掉早期的对话内容，后续工作只能依赖它来恢复上下文，因此必须保留关键信息。";

const SUMMARY_SECTION_GUIDE = [
  "请严格按以下结构输出（用 Markdown 小标题）：",
  "## 目标与意图：用户最初的目标以及当前正在做什么。",
  "## 关键决策：做出的重要决定及其理由。",
  "## 改动文件：创建或修改过的文件，以及每次改动的性质。",
  "## 当前进度：已完成的部分以及工作所处的状态。",
  "## 未完成任务：仍待处理的任务（结合下方给出的任务清单）。",
  "## 注意事项：约束、坑、已经失败的方案，避免重复踩坑。",
].join("\n");

export class ContextCompactor {
  async compact(input: CompactionInput): Promise<CompactionResult> {
    const retainRounds = Math.max(0, Math.floor(input.retainRounds));
    const systemMessages = input.messages.filter((message) => message.role === "system");
    const conversation = input.messages.filter((message) => message.role !== "system");
    const rounds = groupConversationRounds(conversation);

    if (rounds.length <= retainRounds) {
      return {
        messages: input.messages,
        summaryText: "",
        retainedRounds: rounds.length,
        compacted: false,
      };
    }

    const retainedRounds = retainRounds > 0 ? rounds.slice(-retainRounds) : [];
    const collapsedRounds = retainRounds > 0 ? rounds.slice(0, -retainRounds) : rounds;
    const retainedTail = retainedRounds.flat();

    const summaryRequestMessages: ChatMessage[] = [
      ...systemMessages,
      ...collapsedRounds.flat(),
      {
        role: "user",
        content: buildSummaryInstruction(input.openTasks),
      },
    ];

    const summaryText = (await input.summarize({ messages: summaryRequestMessages })).trim();

    const summaryMessage: AssistantChatMessage = {
      role: "assistant",
      content: summaryText,
      kind: "summary",
    };

    return {
      messages: [...systemMessages, summaryMessage, ...retainedTail],
      summaryText,
      retainedRounds: retainedRounds.length,
      compacted: true,
    };
  }
}

function buildSummaryInstruction(openTasks: SessionTask[]): string {
  const taskLines = openTasks.length
    ? openTasks
        .map((task) => {
          const blocked = task.status === "blocked" && task.blockedReason
            ? `，阻塞原因：${task.blockedReason}`
            : "";
          return `- [${task.status}] ${task.title}${blocked}`;
        })
        .join("\n")
    : "（无未完成任务）";

  return [
    SUMMARY_INSTRUCTION_HEADER,
    "",
    SUMMARY_SECTION_GUIDE,
    "",
    "未完成任务清单（请确保这些任务出现在“未完成任务”小节中）：",
    taskLines,
  ].join("\n");
}

function groupConversationRounds(messages: ChatMessage[]): ChatMessage[][] {
  const rounds: ChatMessage[][] = [];
  let currentRound: ChatMessage[] = [];

  for (const message of messages) {
    if (message.role === "user" && currentRound.length > 0) {
      rounds.push(currentRound);
      currentRound = [];
    }
    currentRound.push(message);
  }
  if (currentRound.length > 0) {
    rounds.push(currentRound);
  }
  return rounds;
}
