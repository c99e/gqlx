import { buildSchema, graphqlSync, getIntrospectionQuery } from "graphql";
import type { IntrospectionSchema } from "../src/types.js";

/**
 * Build introspection data from SDL string.
 * Uses the `graphql` package (devDependency) to generate
 * spec-compliant introspection results for testing.
 */
export function introspectionFromSDL(sdl: string): IntrospectionSchema {
  const schema = buildSchema(sdl);
  const result = graphqlSync({ schema, source: getIntrospectionQuery() });
  if (result.errors) {
    throw new Error(`Introspection failed: ${result.errors.map((e) => e.message).join(", ")}`);
  }
  return (result.data as any).__schema as IntrospectionSchema;
}

/**
 * A representative test schema covering common GraphQL patterns:
 * queries, mutations, objects, inputs, enums, unions, connections.
 */
export const TEST_SDL = `
  type Query {
    user(id: ID!): User
    users(filter: UserFilter, first: Int, after: String): UserConnection!
    post(id: ID!): Post
    searchContent(query: String!, type: ContentType): [SearchResult!]!
  }

  type Mutation {
    createUser(input: CreateUserInput!): CreateUserPayload!
    updateUser(id: ID!, input: UpdateUserInput!): UpdateUserPayload!
    deleteUser(id: ID!): DeleteUserPayload!
    createPost(input: CreatePostInput!): Post!
  }

  type User {
    id: ID!
    name: String!
    email: String!
    role: UserRole!
    posts(first: Int): [Post!]!
    createdAt: String!
  }

  type Post {
    id: ID!
    title: String!
    body: String!
    author: User!
    status: PostStatus!
    tags: [String!]!
    createdAt: String!
  }

  type UserConnection {
    edges: [UserEdge!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type UserEdge {
    node: User!
    cursor: String!
  }

  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  input UserFilter {
    role: UserRole
    search: String
    createdAfter: String
  }

  input CreateUserInput {
    name: String!
    email: String!
    role: UserRole
  }

  input UpdateUserInput {
    name: String
    email: String
    role: UserRole
  }

  input CreatePostInput {
    title: String!
    body: String!
    tags: [String!]
  }

  type CreateUserPayload {
    user: User!
  }

  type UpdateUserPayload {
    user: User!
  }

  type DeleteUserPayload {
    deletedId: ID!
  }

  enum UserRole {
    ADMIN
    USER
    MODERATOR
  }

  enum PostStatus {
    DRAFT
    PUBLISHED
    ARCHIVED
  }

  enum ContentType {
    USER
    POST
  }

  union SearchResult = User | Post
`;

/** Pre-built introspection data from TEST_SDL */
export const TEST_INTROSPECTION = introspectionFromSDL(TEST_SDL);
