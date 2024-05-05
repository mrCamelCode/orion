import { IIdentifiable, Id } from './model.ts';

export interface RegisteredItem<T> extends IIdentifiable {
  item: T;
}

export abstract class Registry<T> {
  protected items: Record<Id, RegisteredItem<T>> = {};

  register(item: T): RegisteredItem<T> {
    const id = this.getNextId();

    const registeredItem = {
      item: item,
      id,
    };

    this.items[id] = registeredItem;

    return registeredItem;
  }

  getById(id: Id): RegisteredItem<T> | undefined {
    return this.items[id];
  }

  getBy(predicate: (registeredItem: RegisteredItem<T>) => boolean): RegisteredItem<T> | undefined {
    return Object.values(this.items).find(predicate);
  }

  removeById(id: Id): void {
    delete this.items[id];
  }

  protected getNextId(): Id {
    let nextId = crypto.randomUUID();

    while (this.getById(nextId)) {
      nextId = crypto.randomUUID();
    }

    return nextId;
  }
}
