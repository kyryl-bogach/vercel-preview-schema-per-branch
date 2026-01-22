import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity()
export class Todo {
  @PrimaryKey()
  id!: number;

  @Property()
  title!: string;

  @Property()
  completed: boolean = false;

  @Property()
  createdAt: Date = new Date();
}
