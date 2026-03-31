import type {
  IntrospectionField,
  IntrospectionInputValue,
  IntrospectionSchema,
  IntrospectionType,
  IntrospectionTypeRef,
  ArgInfo,
  EnumValueInfo,
  FieldInfo,
  InputFieldInfo,
  OperationInfo,
  SchemaIndex,
  TypeInfo,
} from "./types.js";


// ============================================================
// Introspection query
// ============================================================

const INTROSPECTION_QUERY = `
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      ...FullType
    }
  }
}

fragment FullType on __Type {
  kind
  name
  description
  fields(includeDeprecated: true) {
    name
    description
    args {
      ...InputValue
    }
    type {
      ...TypeRef
    }
    isDeprecated
    deprecationReason
  }
  inputFields {
    ...InputValue
  }
  interfaces {
    ...TypeRef
  }
  enumValues(includeDeprecated: true) {
    name
    description
    isDeprecated
    deprecationReason
  }
  possibleTypes {
    ...TypeRef
  }
}

fragment InputValue on __InputValue {
  name
  description
  type {
    ...TypeRef
  }
  defaultValue
}

fragment TypeRef on __Type {
  kind
  name
  ofType {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
            }
          }
        }
      }
    }
  }
}
`;

// ============================================================
// Fetch introspection from endpoint
// ============================================================

export async function fetchIntrospection(
  endpoint: string,
  headers: Record<string, string>,
  signal?: AbortSignal
): Promise<IntrospectionSchema> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: INTROSPECTION_QUERY }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Introspection failed: ${response.status} ${response.statusText}${body ? `\n${body.slice(0, 500)}` : ""}`
    );
  }

  const json = await response.json();
  const result = json as { data?: { __schema?: IntrospectionSchema }; errors?: unknown[] };

  if (result.errors) {
    throw new Error(
      `Introspection returned errors:\n${JSON.stringify(result.errors, null, 2).slice(0, 1000)}`
    );
  }

  if (!result.data?.__schema) {
    throw new Error("Introspection response missing __schema");
  }

  return result.data.__schema;
}

// ============================================================
// Parse introspection into a structured index
// ============================================================

/** Built-in types to exclude from user-facing results */
const BUILTIN_TYPES = new Set([
  "__Schema",
  "__Type",
  "__Field",
  "__InputValue",
  "__EnumValue",
  "__Directive",
  "__DirectiveLocation",
]);

const BUILTIN_SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID"]);

export function renderTypeRef(ref: IntrospectionTypeRef): string {
  if (ref.kind === "NON_NULL") {
    return `${renderTypeRef(ref.ofType!)}!`;
  }
  if (ref.kind === "LIST") {
    return `[${renderTypeRef(ref.ofType!)}]`;
  }
  return ref.name ?? "Unknown";
}

function parseArgs(args: IntrospectionInputValue[]): ArgInfo[] {
  return args.map((a) => ({
    name: a.name,
    type: renderTypeRef(a.type),
    description: a.description ?? null,
    defaultValue: a.defaultValue ?? null,
  }));
}

function parseField(f: IntrospectionField): FieldInfo {
  return {
    name: f.name,
    type: renderTypeRef(f.type),
    description: f.description ?? null,
    args: parseArgs(f.args),
    isDeprecated: f.isDeprecated,
    deprecationReason: f.deprecationReason ?? null,
  };
}

function parseInputField(f: IntrospectionInputValue): InputFieldInfo {
  return {
    name: f.name,
    type: renderTypeRef(f.type),
    description: f.description ?? null,
    defaultValue: f.defaultValue ?? null,
  };
}

function parseEnumValue(v: { name: string; description?: string | null; isDeprecated: boolean }): EnumValueInfo {
  return {
    name: v.name,
    description: v.description ?? null,
    isDeprecated: v.isDeprecated,
  };
}

function parseType(t: IntrospectionType): TypeInfo {
  return {
    name: t.name,
    kind: t.kind,
    description: t.description ?? null,
    fields: (t.fields ?? []).map(parseField),
    inputFields: (t.inputFields ?? []).map(parseInputField),
    enumValues: (t.enumValues ?? []).map(parseEnumValue),
    interfaces: (t.interfaces ?? []).map((i) => renderTypeRef(i)),
    possibleTypes: (t.possibleTypes ?? []).map((p) => renderTypeRef(p)),
  };
}

export function parseIntrospection(schema: IntrospectionSchema): SchemaIndex {
  const queryTypeName = schema.queryType?.name ?? null;
  const mutationTypeName = schema.mutationType?.name ?? null;
  const subscriptionTypeName = schema.subscriptionType?.name ?? null;

  const rootTypeNames = new Set(
    [queryTypeName, mutationTypeName, subscriptionTypeName].filter(Boolean) as string[]
  );

  const types = new Map<string, TypeInfo>();
  const queries: OperationInfo[] = [];
  const mutations: OperationInfo[] = [];
  const subscriptions: OperationInfo[] = [];

  for (const t of schema.types) {
    if (BUILTIN_TYPES.has(t.name)) continue;

    const typeInfo = parseType(t);

    // Root operation types get split into individual operations
    if (t.name === queryTypeName && t.fields) {
      for (const f of t.fields) {
        queries.push({
          name: f.name,
          type: renderTypeRef(f.type),
          description: f.description ?? null,
          args: parseArgs(f.args),
        });
      }
    } else if (t.name === mutationTypeName && t.fields) {
      for (const f of t.fields) {
        mutations.push({
          name: f.name,
          type: renderTypeRef(f.type),
          description: f.description ?? null,
          args: parseArgs(f.args),
        });
      }
    } else if (t.name === subscriptionTypeName && t.fields) {
      for (const f of t.fields) {
        subscriptions.push({
          name: f.name,
          type: renderTypeRef(f.type),
          description: f.description ?? null,
          args: parseArgs(f.args),
        });
      }
    }

    // Always add to types map (including root types, useful for reference)
    if (!rootTypeNames.has(t.name)) {
      types.set(t.name, typeInfo);
    }
  }

  return {
    queries,
    mutations,
    subscriptions,
    types,
    queryTypeName,
    mutationTypeName,
    subscriptionTypeName,
  };
}


