export type EmptyObject = Record<string, never>;
export type ValueOf<T> = T[keyof T];