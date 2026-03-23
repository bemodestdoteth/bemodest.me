import { GenericRepository } from '../repository.js';
import { Entity, EntitySchema } from '@bemodest/types';


export class EntityRepository extends GenericRepository<Entity, typeof EntitySchema> {
    constructor() {
        super('entities', EntitySchema);
    }
}
