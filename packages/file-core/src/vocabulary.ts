export interface Vocabulary<TToolName extends string> {
  readonly serverName: string;
  readonly subject: string;
  readonly rootLabel: string;
  readonly readableLabel: string;
  readonly listTool: TToolName;
  readonly tooLargeRecovery: string;
}
