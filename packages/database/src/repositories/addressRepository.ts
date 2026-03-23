import { GenericRepository } from '../repository.js';
import { Address, AddressSchema } from '@bemodest/types';


export class AddressRepository extends GenericRepository<Address, typeof AddressSchema> {
    constructor() {
        super('labelledAddresses', AddressSchema);
    }
}
