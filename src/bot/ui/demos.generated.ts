// Сгенерировано `pnpm demos:build` из scripts/build_demos.py. Руками не править.

import NK1 from '../../../assets/demos/NK1.gif';
import NK2 from '../../../assets/demos/NK2.gif';
import NK3 from '../../../assets/demos/NK3.gif';
import NK4 from '../../../assets/demos/NK4.gif';
import NK5 from '../../../assets/demos/NK5.gif';
import NK6 from '../../../assets/demos/NK6.gif';
import NK7 from '../../../assets/demos/NK7.gif';
import NK8 from '../../../assets/demos/NK8.gif';
import NK9 from '../../../assets/demos/NK9.gif';
import NK10 from '../../../assets/demos/NK10.gif';
import SC1 from '../../../assets/demos/SC1.gif';
import SC2 from '../../../assets/demos/SC2.gif';
import SC3 from '../../../assets/demos/SC3.gif';
import SC4 from '../../../assets/demos/SC4.gif';
import SC6 from '../../../assets/demos/SC6.gif';
import SC8 from '../../../assets/demos/SC8.gif';
import SC9 from '../../../assets/demos/SC9.gif';
import SC10 from '../../../assets/demos/SC10.gif';
import RW1 from '../../../assets/demos/RW1.gif';
import RW2 from '../../../assets/demos/RW2.gif';
import RW5 from '../../../assets/demos/RW5.gif';
import RW6 from '../../../assets/demos/RW6.gif';
import RW7 from '../../../assets/demos/RW7.gif';
import RW8 from '../../../assets/demos/RW8.gif';
import PC1 from '../../../assets/demos/PC1.gif';
import PC2 from '../../../assets/demos/PC2.gif';
import PC3 from '../../../assets/demos/PC3.gif';
import PC4 from '../../../assets/demos/PC4.gif';
import PC5 from '../../../assets/demos/PC5.gif';
import PC6 from '../../../assets/demos/PC6.gif';
import PC7 from '../../../assets/demos/PC7.gif';
import PC8 from '../../../assets/demos/PC8.gif';
import PC9 from '../../../assets/demos/PC9.gif';
import PR1 from '../../../assets/demos/PR1.gif';
import PR3 from '../../../assets/demos/PR3.gif';
import PR4 from '../../../assets/demos/PR4.gif';
import PR5 from '../../../assets/demos/PR5.gif';
import PR6 from '../../../assets/demos/PR6.gif';
import LG2 from '../../../assets/demos/LG2.gif';
import LG4 from '../../../assets/demos/LG4.gif';
import LG5 from '../../../assets/demos/LG5.gif';
import LG6 from '../../../assets/demos/LG6.gif';
import LG7 from '../../../assets/demos/LG7.gif';
import CR1 from '../../../assets/demos/CR1.gif';
import CR2 from '../../../assets/demos/CR2.gif';
import CR3 from '../../../assets/demos/CR3.gif';
import CR4 from '../../../assets/demos/CR4.gif';
import CR5 from '../../../assets/demos/CR5.gif';
import CR6 from '../../../assets/demos/CR6.gif';
import CR7 from '../../../assets/demos/CR7.gif';
import CR8 from '../../../assets/demos/CR8.gif';
import MB1 from '../../../assets/demos/MB1.gif';
import MB2 from '../../../assets/demos/MB2.gif';
import MB3 from '../../../assets/demos/MB3.gif';
import MB4 from '../../../assets/demos/MB4.gif';
import MB5 from '../../../assets/demos/MB5.gif';
import MB6 from '../../../assets/demos/MB6.gif';
import MB7 from '../../../assets/demos/MB7.gif';
import MB8 from '../../../assets/demos/MB8.gif';
import MB9 from '../../../assets/demos/MB9.gif';

/** Рисованные схемы движения, вшитые в воркер. Своего хостинга нет (ADR-014). */
export const BUILTIN_DEMOS: Record<string, ArrayBuffer> = {
  NK1,
  NK2,
  NK3,
  NK4,
  NK5,
  NK6,
  NK7,
  NK8,
  NK9,
  NK10,
  SC1,
  SC2,
  SC3,
  SC4,
  SC6,
  SC8,
  SC9,
  SC10,
  RW1,
  RW2,
  RW5,
  RW6,
  RW7,
  RW8,
  PC1,
  PC2,
  PC3,
  PC4,
  PC5,
  PC6,
  PC7,
  PC8,
  PC9,
  PR1,
  PR3,
  PR4,
  PR5,
  PR6,
  LG2,
  LG4,
  LG5,
  LG6,
  LG7,
  CR1,
  CR2,
  CR3,
  CR4,
  CR5,
  CR6,
  CR7,
  CR8,
  MB1,
  MB2,
  MB3,
  MB4,
  MB5,
  MB6,
  MB7,
  MB8,
  MB9,
};

/** Отпечаток каждой схемы: сменился — кеш `file_id` устарел. */
export const BUILTIN_DEMO_DIGESTS: Record<string, string> = {
  NK1: '035dbd9d7e40f8fd',
  NK2: 'cd29a22f83d8f0a4',
  NK3: 'b7394e71ea50415d',
  NK4: '04ec98f8dfa41f55',
  NK5: '08aee669a5fa40a4',
  NK6: '002185b23d6f1631',
  NK7: 'c413dfda22adbb10',
  NK8: '6981186a5348c1be',
  NK9: 'f6fc7cda96a4bd43',
  NK10: 'c655617d7a734fb1',
  SC1: 'f54f5d2e26edc1c4',
  SC2: '26fc71be97c6e595',
  SC3: '3c8458e94c8295a6',
  SC4: '7ee7e3b2d46f1780',
  SC6: 'c5e208fc42f94d43',
  SC8: '2977ed362833fb6a',
  SC9: '6baf0c4fe4ffa12e',
  SC10: '3bb5516e5c986898',
  RW1: 'ebd2348deb85916c',
  RW2: '59621ec91ba9f19e',
  RW5: '6a7b3024f6972292',
  RW6: '2e35e1cb3cd133bb',
  RW7: 'd6cf811155f7be40',
  RW8: 'c5e3e20463d27314',
  PC1: 'c34ba6f3a5acaf1b',
  PC2: 'a74f0ff70e184212',
  PC3: '337f92db40f5f746',
  PC4: '5dc0f82f4b4198ca',
  PC5: '69e4ef7e63058f88',
  PC6: 'dee8ca3264fc5ecb',
  PC7: 'fc60984c99e576fb',
  PC8: '86a8d914fb08d069',
  PC9: 'c3e4475fc1c362ae',
  PR1: '16f5c2f57776f04b',
  PR3: '1065ad8cb72ebe64',
  PR4: '754641a08e91511a',
  PR5: '0895dd5a48ef980a',
  PR6: 'ebbcffb14786dd58',
  LG2: '85afdb8c360d8631',
  LG4: '1a7674b1a44e5eed',
  LG5: 'a9c8b5b3adce0ceb',
  LG6: '6b7ad5b7f4fcd6d1',
  LG7: '0ab452c4c2d69c64',
  CR1: 'c11fbec3f1eb600b',
  CR2: 'dcc75888418440ad',
  CR3: '010bd9cad6771014',
  CR4: '4489d058139a070d',
  CR5: '4db932795d0cdd93',
  CR6: '346c7027556c945f',
  CR7: '3416a26052b68fdc',
  CR8: '43b3831bde3f0a38',
  MB1: 'e1097054b87b86cc',
  MB2: '3040a3b09e7c537d',
  MB3: '20180ae8781bfbfd',
  MB4: 'c65da699adad2133',
  MB5: '65f04232aba1b743',
  MB6: '691f1f4a1f815c6c',
  MB7: '3ced433d9d902793',
  MB8: '6bacb6ad9cd588de',
  MB9: '535ae2ffc1bcd8dc',
};
