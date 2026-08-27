use sha3::{Digest, Keccak256};

const DOMAIN_TYPE: &[u8] =
    b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
const TRANSFER_TYPE: &[u8] = b"TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)";

#[derive(Clone, PartialEq, Eq)]
pub(super) struct Uint256([u8; 32]);

impl Uint256 {
    pub(super) fn parse_decimal(value: &str) -> Option<Self> {
        if value.is_empty()
            || value.len() > 78
            || (value.len() > 1 && value.starts_with('0'))
            || !value.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }
        let mut output = [0_u8; 32];
        for digit in value.bytes() {
            let mut carry = u16::from(digit - b'0');
            for byte in output.iter_mut().rev() {
                let next = u16::from(*byte) * 10 + carry;
                *byte = next as u8;
                carry = next >> 8;
            }
            if carry != 0 {
                return None;
            }
        }
        Some(Self(output))
    }

    pub(super) fn from_u64(value: u64) -> Self {
        let mut bytes = [0_u8; 32];
        bytes[24..].copy_from_slice(&value.to_be_bytes());
        Self(bytes)
    }

    pub(super) fn is_zero(&self) -> bool {
        self.0.iter().all(|byte| *byte == 0)
    }

    pub(super) fn fits_u64(&self) -> Option<u64> {
        if self.0[..24].iter().any(|byte| *byte != 0) {
            return None;
        }
        Some(u64::from_be_bytes(self.0[24..].try_into().ok()?))
    }

    pub(super) fn is_greater_than(&self, other: &Self) -> bool {
        self.0 > other.0
    }

    pub(super) fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

pub(super) fn domain_separator(
    name: &str,
    version: &str,
    chain_id: u64,
    verifying_contract: &[u8; 20],
) -> [u8; 32] {
    let mut encoded = Vec::with_capacity(32 * 5);
    encoded.extend_from_slice(&keccak(DOMAIN_TYPE));
    encoded.extend_from_slice(&keccak(name.as_bytes()));
    encoded.extend_from_slice(&keccak(version.as_bytes()));
    encoded.extend_from_slice(Uint256::from_u64(chain_id).as_bytes());
    encoded.extend_from_slice(&address_word(verifying_contract));
    keccak(&encoded)
}

pub(super) struct TransferMessage<'a> {
    pub(super) from: &'a [u8; 20],
    pub(super) to: &'a [u8; 20],
    pub(super) value: &'a Uint256,
    pub(super) valid_after: u64,
    pub(super) valid_before: u64,
    pub(super) nonce: &'a [u8; 32],
}

pub(super) fn transfer_digest(
    domain_separator: &[u8; 32],
    message: TransferMessage<'_>,
) -> [u8; 32] {
    let mut encoded = Vec::with_capacity(32 * 7);
    encoded.extend_from_slice(&keccak(TRANSFER_TYPE));
    encoded.extend_from_slice(&address_word(message.from));
    encoded.extend_from_slice(&address_word(message.to));
    encoded.extend_from_slice(message.value.as_bytes());
    encoded.extend_from_slice(Uint256::from_u64(message.valid_after).as_bytes());
    encoded.extend_from_slice(Uint256::from_u64(message.valid_before).as_bytes());
    encoded.extend_from_slice(message.nonce);
    let struct_hash = keccak(&encoded);

    let mut preimage = [0_u8; 66];
    preimage[..2].copy_from_slice(b"\x19\x01");
    preimage[2..34].copy_from_slice(domain_separator);
    preimage[34..].copy_from_slice(&struct_hash);
    keccak(&preimage)
}

fn address_word(address: &[u8; 20]) -> [u8; 32] {
    let mut word = [0_u8; 32];
    word[12..].copy_from_slice(address);
    word
}

fn keccak(value: &[u8]) -> [u8; 32] {
    Keccak256::digest(value).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decode<const N: usize>(value: &str) -> [u8; N] {
        assert_eq!(value.len(), N * 2);
        let mut output = [0_u8; N];
        for (index, byte) in output.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).unwrap();
        }
        output
    }

    #[test]
    fn base_usdc_domain_and_transfer_digest_match_official_eip712_shape() {
        let token = decode("833589fcd6edb6e08f4c7c32d4f71b54bda02913");
        let domain = domain_separator("USD Coin", "2", 8453, &token);
        assert_eq!(
            domain,
            decode("02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f")
        );

        let from = decode("7e5f4552091a69125d5dfcb7b8c2659029395bdf");
        let to = decode("2222222222222222222222222222222222222222");
        let nonce = [0xab; 32];
        let digest = transfer_digest(
            &domain,
            TransferMessage {
                from: &from,
                to: &to,
                value: &Uint256::parse_decimal("1250000").unwrap(),
                valid_after: 0,
                valid_before: 1_760_000_000,
                nonce: &nonce,
            },
        );
        assert_eq!(
            digest,
            decode("e36116884332d647c03f39e04ea71db8f78013a05a7b0c6be310060305b96218")
        );
    }

    #[test]
    fn uint256_parser_is_canonical_and_bounded() {
        assert!(Uint256::parse_decimal("0").unwrap().is_zero());
        assert_eq!(
            Uint256::parse_decimal("18446744073709551615")
                .unwrap()
                .fits_u64(),
            Some(u64::MAX)
        );
        assert!(Uint256::parse_decimal("").is_none());
        assert!(Uint256::parse_decimal("01").is_none());
        assert!(Uint256::parse_decimal("+1").is_none());
        assert!(Uint256::parse_decimal("1.0").is_none());
        assert!(
            Uint256::parse_decimal(
                "115792089237316195423570985008687907853269984665640564039457584007913129639936"
            )
            .is_none()
        );
    }
}
