// Windows da konsol oynasini yashirish (faqat UI ko'rinadi)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lokal_messenger_lib::run();
}
