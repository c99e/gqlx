# TODO

## Discovery over Documentation

- Per-category limit when `kind` is unset/all — apply `limit` independently to each category (query, mutation, type, input, enum, etc.) so types don't drown out operations in broad searches
- Field/value counts in search result signatures — show `type Product (52 fields)`, `input ProductCreateInput (18 fields, 3 required)`, `enum CurrencyCode (160 values)` to help the agent gauge size before expanding
- Enum value search — allow searching within enum values (e.g., `gql_search("EUR", kind: "enum")` → `CurrencyCode.EUR`) for validating specific values without loading entire enums
- *(deferred)* Proactive neighbour surfacing — when returning results, suggest related operations the agent didn't explicitly search for (e.g., searching `createUser` could hint at `updateUser`, `deleteUser`, `CreateUserInput`)

## Progressive Disclosure

- Replace `expand` with `verbose` toggle on `gql_type` — default compact mode (field names, types, args only); verbose mode adds descriptions and referenced type expansion
- `pattern` filter on `gql_type` — allow filtering a type's fields by substring (e.g., `gql_type("Product", pattern: "price")`) to avoid dumping 50+ fields when only a few are needed

## Feature Requests

- Batch/template execution on `gql_execute` — accept an operation template + array of variable sets; extension constructs aliased mutations internally, handles chunking, and collects results
