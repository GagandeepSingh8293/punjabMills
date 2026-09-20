mod commands;
mod db;
mod ocr;
mod sync;
mod util;

use std::sync::Mutex;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("dyeai.db");
            let conn = rusqlite::Connection::open(&db_path)?;
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "foreign_keys", "ON")?;
            db::init(&conn)?;
            app.manage(commands::DbState(Mutex::new(conn)));
            sync::start(app.handle().clone(), db_path.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::login,
            commands::get_user,
            commands::update_profile,
            commands::update_avatar,
            commands::change_password,
            commands::list_masters,
            commands::create_master,
            commands::update_master,
            commands::lookup_gst,
            commands::get_tenant_settings,
            commands::save_tenant_settings,
            commands::get_job_work_settings,
            commands::save_job_work_settings,
            commands::get_invoice_numbering_settings,
            commands::save_invoice_numbering_settings,
            commands::list_challans,
            commands::get_challan,
            commands::create_challan,
            commands::update_challan,
            commands::get_challan_filter_options,
            commands::list_invoices,
            commands::get_invoice,
            commands::generate_invoices,
            commands::update_invoice_status,
            commands::update_invoice_details,
            commands::get_dashboard_stats,
            commands::get_activity_feed,
            commands::global_search,
            commands::process_scan_capture,
            commands::get_scan_extraction,
            commands::set_gemini_api_key,
            commands::get_gemini_config,
            commands::get_scan_photo,
            commands::set_gst_api_key,
            commands::get_gst_config,
            sync::get_sync_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}