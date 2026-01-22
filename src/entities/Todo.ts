import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'todo' })
export class Todo {
  [OptionalProps]?: 'completed' | 'createdAt';

  @PrimaryKey({ autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  title!: string;

  @Property({ type: 'boolean' })
  completed: boolean = false;

  @Property({ type: 'Date' })
  createdAt: Date = new Date();
}
