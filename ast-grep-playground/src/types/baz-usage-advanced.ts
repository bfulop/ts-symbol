/* Advanced Baz usages */
type Alias = Wrapper<Baz>

type Intersection = Baz & { tag: string }

type Conditional<T> = T extends Baz ? true : false

type WithConstraint<T extends Baz> = T

type Mapped<T extends Baz> = {
  [K in keyof T]: T[K]
}

declare function identity<T>(value: T): T
const inferCall = identity<Baz>({} as Baz)

declare const value: unknown
const satisfiesCheck = value satisfies Baz

function acceptsBaz(param: Baz): Baz {
  return param
}

interface UsesBaz {
  prop: Baz
}

class HasBazField {
  field!: Baz
}
