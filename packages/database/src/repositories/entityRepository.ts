import { GenericRepository } from '../repository.js';
import { Entity, EntitySchema } from '../schemas/entity.js';


export class EntityRepository extends GenericRepository<Entity, typeof EntitySchema> {
    constructor() {
        super('entities', EntitySchema);
    }
}
