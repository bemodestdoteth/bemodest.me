import { GenericRepository } from '../repository.js';
import { Address, AddressSchema } from '../schemas/address.js';


export class AddressRepository extends GenericRepository<Address, typeof AddressSchema> {
    constructor() {
        super('labelledAddresses', AddressSchema);
    }
}
