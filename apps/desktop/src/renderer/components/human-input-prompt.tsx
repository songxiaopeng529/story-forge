import type {
  HumanInputAnswer,
  HumanInputQuestion,
  HumanInputRequestEvent,
  HumanInputResponse,
} from "@story-forge/shared";
import { useEffect, useState } from "react";

type AnswerDraft = {
  selectedOptionIds: string[];
  text: string;
};

export function HumanInputCard(props: {
  request: HumanInputRequestEvent;
  responding: boolean;
  onRespond: (response: Omit<HumanInputResponse, "requestId">) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, AnswerDraft>>({});
  const [remark, setRemark] = useState("");
  const titleId = `human-input-title-${props.request.requestId}`;

  useEffect(() => {
    setAnswers(createInitialAnswers(props.request.questions));
    setRemark("");
  }, [props.request.requestId, props.request.questions]);

  const canSubmit = canSubmitHumanInput(props.request, answers, remark);

  return (
    <article
      aria-labelledby={titleId}
      className="rounded-[10px] border border-forge-line bg-white px-4 py-3 text-sm shadow-sm"
      data-testid="human-input-card"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-forge-muted">
        Human in the Loop
      </p>
      <h2 className="mt-1 whitespace-pre-wrap break-words text-base font-semibold text-forge-ink" id={titleId}>
        {props.request.title}
      </h2>
      {props.request.description ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-forge-muted">
          {props.request.description}
        </p>
      ) : null}

      <div className="mt-5 grid max-h-[60vh] gap-4 overflow-y-auto pr-1">
        {props.request.questions.map((question) => (
          <QuestionField
            answer={answers[question.id] ?? emptyAnswer}
            disabled={props.responding}
            key={question.id}
            onChange={(answer) =>
              setAnswers((current) => ({
                ...current,
                [question.id]: answer,
              }))}
            question={question}
          />
        ))}
        {props.request.remark?.enabled ? (
          <label className="block rounded-lg border border-forge-line bg-forge-canvas/40 p-3">
            <span className="text-sm font-semibold text-forge-ink">
              {props.request.remark.label ?? "Remark"}
              {props.request.remark.required ? <span className="text-forge-danger"> *</span> : null}
            </span>
            <textarea
              className="mt-2 h-24 w-full resize-y rounded-md border border-forge-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-forge-ink/50 disabled:opacity-60"
              disabled={props.responding}
              onChange={(event) => setRemark(event.currentTarget.value)}
              placeholder={props.request.remark.placeholder}
              value={remark}
            />
          </label>
        ) : null}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          className="rounded-md border border-forge-line px-4 py-2 text-sm font-medium text-forge-muted hover:bg-forge-canvas disabled:opacity-60"
          disabled={props.responding}
          onClick={() => props.onRespond({ cancelled: true })}
          type="button"
        >
          Cancel
        </button>
        <button
          className="rounded-md bg-forge-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={props.responding || !canSubmit}
          onClick={() =>
            props.onRespond({
              answers: buildHumanInputAnswers(props.request.questions, answers),
              ...readRemarkResponse(remark),
            })}
          type="button"
        >
          Submit
        </button>
      </div>
    </article>
  );
}

export function HumanInputPrompt(props: {
  request: HumanInputRequestEvent;
  responding: boolean;
  onRespond: (response: Omit<HumanInputResponse, "requestId">) => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-950/25 px-4 py-20">
      <div className="w-full max-w-3xl">
        <HumanInputCard {...props} />
      </div>
    </div>
  );
}

function QuestionField(props: {
  question: HumanInputQuestion;
  answer: AnswerDraft;
  disabled: boolean;
  onChange: (answer: AnswerDraft) => void;
}) {
  const required = props.question.required ? <span className="text-forge-danger"> *</span> : null;

  return (
    <section className="rounded-lg border border-forge-line bg-forge-canvas/40 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-forge-muted">
          {props.question.header}
        </span>
        <h3 className="flex-1 whitespace-pre-wrap text-sm font-semibold leading-6 text-forge-ink">
          {props.question.question}
          {required}
        </h3>
      </div>

      {props.question.type === "text" ? (
        <textarea
          className="mt-3 h-24 w-full resize-y rounded-md border border-forge-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-forge-ink/50 disabled:opacity-60"
          disabled={props.disabled}
          onChange={(event) =>
            props.onChange({ selectedOptionIds: [], text: event.currentTarget.value })}
          value={props.answer.text}
        />
      ) : (
        <div className="mt-3 grid gap-2">
          {(props.question.options ?? []).map((option) => {
            const selected = props.answer.selectedOptionIds.includes(option.id);
            return (
              <button
                aria-pressed={selected}
                className={`rounded-md border px-3 py-2.5 text-left text-sm transition disabled:opacity-60 ${
                  selected
                    ? "border-forge-ink bg-white text-forge-ink"
                    : "border-forge-line bg-white/70 text-forge-muted hover:border-forge-ink/40"
                }`}
                disabled={props.disabled}
                key={option.id}
                onClick={() =>
                  props.onChange(nextOptionAnswer(props.question, props.answer, option.id))}
                type="button"
              >
                <span className="block font-semibold">{option.label}</span>
                {option.description ? (
                  <span className="mt-1 block text-xs leading-5 text-forge-muted">
                    {option.description}
                  </span>
                ) : null}
              </button>
            );
          })}
          {props.question.allowOther ? (
            <input
              className="rounded-md border border-forge-line bg-white px-3 py-2 text-sm outline-none focus:border-forge-ink/50 disabled:opacity-60"
              disabled={props.disabled}
              onChange={(event) =>
                props.onChange({
                  ...props.answer,
                  ...(props.question.type === "single_select" ? { selectedOptionIds: [] } : {}),
                  text: event.currentTarget.value,
                })}
              placeholder="Other..."
              value={props.answer.text}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}

const emptyAnswer: AnswerDraft = { selectedOptionIds: [], text: "" };

function createInitialAnswers(questions: HumanInputQuestion[]): Record<string, AnswerDraft> {
  return Object.fromEntries(
    questions.map((question) => [question.id, { selectedOptionIds: [], text: "" }]),
  );
}

function nextOptionAnswer(
  question: HumanInputQuestion,
  current: AnswerDraft,
  optionId: string,
): AnswerDraft {
  if (question.type === "single_select") {
    return { selectedOptionIds: [optionId], text: "" };
  }
  const selected = current.selectedOptionIds.includes(optionId)
    ? current.selectedOptionIds.filter((candidate) => candidate !== optionId)
    : [...current.selectedOptionIds, optionId];
  return { ...current, selectedOptionIds: selected };
}

function canSubmitHumanInput(
  request: HumanInputRequestEvent,
  answers: Record<string, AnswerDraft>,
  remark: string,
): boolean {
  const questionsAnswered = request.questions.every((question) => {
    if (!question.required) {
      return true;
    }
    const answer = answers[question.id] ?? emptyAnswer;
    if (question.type === "text") {
      return Boolean(answer.text.trim());
    }
    return answer.selectedOptionIds.length > 0 || Boolean(answer.text.trim());
  });
  const remarkAnswered = !request.remark?.enabled
    || !request.remark.required
    || Boolean(remark.trim());
  return questionsAnswered && remarkAnswered;
}

function buildHumanInputAnswers(
  questions: HumanInputQuestion[],
  answers: Record<string, AnswerDraft>,
): HumanInputAnswer[] {
  return questions.map((question) => {
    const answer = answers[question.id] ?? emptyAnswer;
    const selectedLabels = labelsForSelectedOptions(question, answer.selectedOptionIds);
    const text = answer.text.trim();
    return {
      id: question.id,
      header: question.header,
      question: question.question,
      type: question.type,
      ...(answer.selectedOptionIds.length ? { selectedOptionIds: answer.selectedOptionIds } : {}),
      ...(selectedLabels.length ? { selectedLabels } : {}),
      ...(text ? { text } : {}),
    };
  });
}

function labelsForSelectedOptions(question: HumanInputQuestion, selectedIds: string[]): string[] {
  if (!question.options?.length || selectedIds.length === 0) {
    return [];
  }
  const labelsById = new Map(question.options.map((option) => [option.id, option.label]));
  return selectedIds.flatMap((id) => {
    const label = labelsById.get(id);
    return label ? [label] : [];
  });
}

function readRemarkResponse(remark: string): Pick<HumanInputResponse, "remark"> {
  const trimmed = remark.trim();
  return trimmed ? { remark: trimmed } : {};
}
