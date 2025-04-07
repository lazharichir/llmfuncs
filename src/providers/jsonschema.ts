export type JsonSchemaType =
	| "string"
	| "number"
	| "integer"
	| "boolean"
	| "array"
	| "object"
	| "null";

export interface JsonSchema {
	type: JsonSchemaType | Array<JsonSchemaType>;
	description?: string;
	required?: string[];
	properties?: { [key: string]: JsonSchema };
	items?: JsonSchema;
	examples?: unknown[];
	minItems?: number;
	maxItems?: number;
	minimum?: number;
	maximum?: number;
	enum?: unknown[];
}
