// ============================================================
// GraphQL introspection types (matches the GraphQL spec)
// ============================================================

export interface IntrospectionResult {
  __schema: IntrospectionSchema;
}

export interface IntrospectionSchema {
  queryType: { name: string } | null;
  mutationType: { name: string } | null;
  subscriptionType: { name: string } | null;
  types: IntrospectionType[];
}

export type IntrospectionTypeKind =
  | "SCALAR"
  | "OBJECT"
  | "INTERFACE"
  | "UNION"
  | "ENUM"
  | "INPUT_OBJECT"
  | "LIST"
  | "NON_NULL";

export interface IntrospectionType {
  kind: IntrospectionTypeKind;
  name: string;
  description?: string | null;
  fields?: IntrospectionField[] | null;
  inputFields?: IntrospectionInputValue[] | null;
  interfaces?: IntrospectionTypeRef[] | null;
  enumValues?: IntrospectionEnumValue[] | null;
  possibleTypes?: IntrospectionTypeRef[] | null;
}

export interface IntrospectionField {
  name: string;
  description?: string | null;
  args: IntrospectionInputValue[];
  type: IntrospectionTypeRef;
  isDeprecated: boolean;
  deprecationReason?: string | null;
}

export interface IntrospectionInputValue {
  name: string;
  description?: string | null;
  type: IntrospectionTypeRef;
  defaultValue?: string | null;
}

export interface IntrospectionEnumValue {
  name: string;
  description?: string | null;
  isDeprecated: boolean;
  deprecationReason?: string | null;
}

export interface IntrospectionTypeRef {
  kind: IntrospectionTypeKind;
  name?: string | null;
  ofType?: IntrospectionTypeRef | null;
}

// ============================================================
// Parsed schema index
// ============================================================

export interface SchemaIndex {
  queries: OperationInfo[];
  mutations: OperationInfo[];
  subscriptions: OperationInfo[];
  types: Map<string, TypeInfo>;
  queryTypeName: string | null;
  mutationTypeName: string | null;
  subscriptionTypeName: string | null;
}

export interface TypeInfo {
  name: string;
  kind: IntrospectionTypeKind;
  description: string | null;
  fields: FieldInfo[];
  inputFields: InputFieldInfo[];
  enumValues: EnumValueInfo[];
  interfaces: string[];
  possibleTypes: string[];
}

export interface FieldInfo {
  name: string;
  type: string;
  description: string | null;
  args: ArgInfo[];
  isDeprecated: boolean;
  deprecationReason: string | null;
}

export interface InputFieldInfo {
  name: string;
  type: string;
  description: string | null;
  defaultValue: string | null;
}

export interface ArgInfo {
  name: string;
  type: string;
  description: string | null;
  defaultValue: string | null;
}

export interface EnumValueInfo {
  name: string;
  description: string | null;
  isDeprecated: boolean;
}

export interface OperationInfo {
  name: string;
  type: string;
  description: string | null;
  args: ArgInfo[];
}

// ============================================================
// Search types
// ============================================================

export interface SearchOptions {
  pattern: string;
  kind?: "query" | "mutation" | "subscription" | "type" | "input" | "enum" | "scalar" | "union" | "interface" | "all";
  limit?: number;
}

export interface SearchResult {
  kind: string;
  name: string;
  signature: string;
  description: string | null;
  parentType?: string;
}

// ============================================================
// Config / execution types
// ============================================================

export interface ShopifyConfig {
  store: string;
  clientId: string;
  clientSecret: string;
  apiVersion: string;
}

export interface LinearConfig {
  apiKey: string;
}

export interface GqlProvider {
  readonly name: string;
  getEndpoint(): string;
  getHeaders(): Promise<Record<string, string>>;
  reset(): void;
}

export interface ExecuteOptions {
  signal?: AbortSignal;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface GqlResponse {
  data?: unknown;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: Array<string | number>;
    extensions?: Record<string, unknown>;
  }>;
  extensions?: Record<string, unknown>;
}

// ============================================================
// Batch execution types
// ============================================================

export interface BatchExecuteOptions extends ExecuteOptions {
  chunkSize?: number;
}

export interface BatchResult {
  index: number;
  data: unknown;
  errors: Array<{ message: string; [key: string]: unknown }> | null;
}

export interface BatchResponse {
  results: BatchResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    chunks: number;
  };
}
