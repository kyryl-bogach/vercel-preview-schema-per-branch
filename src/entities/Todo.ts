import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class Todo {
  @PrimaryKey({ type: 'number' })
  id!: number;

  @Property({ type: 'string' })
  title!: string;

  @Property({ type: 'boolean' })
  completed: boolean = false;

  @Property({ type: 'Date' })
  createdAt: Date = new Date();
}
