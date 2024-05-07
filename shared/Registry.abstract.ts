import { Event } from '@jtjs/event';
import { IIdentifiable, Id } from './model.ts';

export interface RegisteredItem<T> extends IIdentifiable {
  item: T;
}

export type ItemRegisteredHandler<T> = (item: RegisteredItem<T>) => void;
export type ItemRemovedHandler<T> = (item: RegisteredItem<T>) => void;

export abstract class Registry<T> {
  onItemRegistered = new Event<ItemRegisteredHandler<T>>();
  onItemRemoved = new Event<ItemRemovedHandler<T>>();

  protected items: Record<Id, RegisteredItem<T>> = {};

  register(item: T): RegisteredItem<T> {
    const id = this.getNextId();

    const registeredItem = {
      item: item,
      id,
    };

    this.items[id] = registeredItem;

    this.onItemRegistered.trigger(registeredItem);

    return registeredItem;
  }

  has(id: Id): boolean {
    return !!this.getById(id);
  }

  getById(id: Id): RegisteredItem<T> | undefined {
    return this.items[id];
  }

  getBy(predicate: (registeredItem: RegisteredItem<T>) => boolean): RegisteredItem<T> | undefined {
    return Object.values(this.items).find(predicate);
  }

  removeById(id: Id): void {
    const existingItem = this.getById(id);

    if (existingItem) {
      delete this.items[id];

      this.onItemRemoved.trigger(existingItem);
    }
  }

  protected getNextId(): Id {
    let nextId = crypto.randomUUID();

    while (this.getById(nextId)) {
      nextId = crypto.randomUUID();
    }

    return nextId;
  }
}
