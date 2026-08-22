declare class SelfEvolveManager {
  init(): void;
  recordFailure(errorType: string, error: any, attemptedSolutions?: string[]): any;
  searchSolution(errorType: string, errorMessage: string): any[];
  generateDailyReport(): any;
}

export { SelfEvolveManager };
