import type {
  AgentSelection,
  CodexModel,
  WorkerModel,
} from "@chat/contracts/agent/model";

export interface SelectionInput {
  readonly codexModels: readonly CodexModel[];
  readonly workerModels: readonly WorkerModel[];
  readonly user: AgentSelection;
  readonly session: AgentSelection | null;
  readonly defaults: {
    readonly codexModel: string | undefined;
    readonly effort: string | undefined;
    readonly workerModel: string | undefined;
  };
}

function firstOf<T>(
  candidates: readonly (T | null | undefined)[],
  accepts: (value: T) => boolean,
): T | null {
  const present = candidates.filter(
    (value): value is T => value !== null && value !== undefined,
  );

  return present.find(accepts) ?? null;
}

/**
 * The model a turn runs on: the conversation's choice, then the reader's
 * default, then the deployment's, each only while the catalog still offers it.
 *
 * Guard: an empty catalog accepts every candidate. It is empty because a host
 * could not be asked, not because nothing is installed, and refusing every
 * choice would move a working conversation onto a default nobody picked.
 *
 * @param input the catalogs and the choices at each level
 * @returns the resolved choice
 */
export function resolveSelection(input: SelectionInput): AgentSelection {
  const { codexModels, workerModels, user, session, defaults } = input;
  const codexIds = new Set(codexModels.map((model) => model.id));
  const workerIds = new Set(workerModels.map((model) => model.id));
  const catalogDefault = codexModels.find((model) => model.isDefault)?.id;

  const codexModel = firstOf(
    [session?.codexModel, user.codexModel, defaults.codexModel, catalogDefault],
    (id) => codexIds.size === 0 || codexIds.has(id),
  );
  const model = codexModels.find((entry) => entry.id === codexModel);
  const supported = new Set(model?.efforts.map((entry) => entry.effort));
  const effort =
    firstOf(
      [session?.effort, user.effort, defaults.effort],
      (value) => model === undefined || supported.has(value),
    ) ??
    model?.defaultEffort ??
    null;
  const workerModel = firstOf(
    [session?.workerModel, user.workerModel, defaults.workerModel],
    (id) => workerIds.size === 0 || workerIds.has(id),
  );

  return { codexModel, effort, workerModel };
}
