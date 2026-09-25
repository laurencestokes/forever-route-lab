import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import type {
  AssumptionOverrides,
  CharacterProfile,
  CustomQuest,
  EntityRef,
  FilterAst,
  Location,
  ProjectV1,
  PublishedPoint,
  QuestOverride,
  Route,
  RouteGroup,
  RouteProfile,
  RouteStep,
  RxpImport,
  SourcedPoint,
  StepCondition,
} from '../domain';
import type {
  assumptionOverridesSchema,
  characterProfileSchema,
  customQuestSchema,
  entityRefSchema,
  filterAstSchema,
  locationSchema,
  projectSchema,
  publishedPointSchema,
  questOverrideSchema,
  routeGroupSchema,
  routeProfileSchema,
  routeSchema,
  routeStepSchema,
  rxpImportSchema,
  sourcedPointSchema,
  stepConditionSchema,
} from './schema';

/**
 * Structural normal form: intersections are flattened into one object type (`StepBase & {...}`
 * versus zod's single object), while readonly and optional modifiers, arrays versus tuples, and
 * brands are kept. Primitives, including branded ones, are left as they are.
 */
type Normalize<T> = unknown extends T
  ? T
  : T extends string | number | boolean | bigint | symbol | null | undefined
    ? T
    : { [K in keyof T]: Normalize<T[K]> };

/** Strict identity (not mutual assignability): readonly, optionality and `| undefined` all count. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Same<S extends z.ZodType, T> = Equals<Normalize<z.infer<S>>, Normalize<T>>;

describe('schema types equal the domain types', () => {
  it('project', () => {
    const same: Same<typeof projectSchema, ProjectV1> = true;
    expect(same).toBe(true);
    // Mutual assignability as a second, independent check.
    expectTypeOf<z.infer<typeof projectSchema>>().toExtend<ProjectV1>();
    expectTypeOf<ProjectV1>().toExtend<z.infer<typeof projectSchema>>();
  });

  it('parts', () => {
    const checks: readonly true[] = [
      true satisfies Same<typeof routeSchema, Route>,
      true satisfies Same<typeof routeStepSchema, RouteStep>,
      true satisfies Same<typeof routeGroupSchema, RouteGroup>,
      true satisfies Same<typeof characterProfileSchema, CharacterProfile>,
      true satisfies Same<typeof routeProfileSchema, RouteProfile>,
      true satisfies Same<typeof assumptionOverridesSchema, AssumptionOverrides>,
      true satisfies Same<typeof customQuestSchema, CustomQuest>,
      true satisfies Same<typeof questOverrideSchema, QuestOverride>,
      true satisfies Same<typeof rxpImportSchema, RxpImport>,
      true satisfies Same<typeof locationSchema, Location>,
      true satisfies Same<typeof sourcedPointSchema, SourcedPoint>,
      true satisfies Same<typeof publishedPointSchema, PublishedPoint>,
      true satisfies Same<typeof entityRefSchema, EntityRef>,
      true satisfies Same<typeof stepConditionSchema, StepCondition>,
      true satisfies Same<typeof filterAstSchema, FilterAst>,
    ];
    expect(checks.every(Boolean)).toBe(true);
  });

  it('the checker itself tells modifiers apart', () => {
    expectTypeOf<Equals<Normalize<{ readonly a: number }>, Normalize<{ a: number }>>>().toEqualTypeOf<false>();
    expectTypeOf<Equals<Normalize<{ a?: number }>, Normalize<{ a?: number | undefined }>>>().toEqualTypeOf<false>();
    expectTypeOf<Equals<Normalize<readonly number[]>, Normalize<number[]>>>().toEqualTypeOf<false>();
    expectTypeOf<Equals<Normalize<{ a: number | null }>, Normalize<{ a: number }>>>().toEqualTypeOf<false>();
    expectTypeOf<Equals<Normalize<{ a: 1 } & { b: 2 }>, Normalize<{ a: 1; b: 2 }>>>().toEqualTypeOf<true>();
    expectTypeOf<Equals<Normalize<{ k: 'a' } | { k: 'b' }>, Normalize<{ k: 'a' }>>>().toEqualTypeOf<false>();
  });
});
