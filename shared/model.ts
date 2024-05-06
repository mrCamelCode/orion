export interface IIdentifiable {
  id: string;
}

export type Id = IIdentifiable['id'];

export type IdToken = string;
