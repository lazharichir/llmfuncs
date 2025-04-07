import type { LLMFuncsConfig } from "@/shared/config";

export type EffectiveParallelismOptions = Required<
	NonNullable<LLMFuncsConfig["parallelism"]>
>;
