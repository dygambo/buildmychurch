/** A blank spreadsheet with the columns the importer understands best, plus two example rows. */
export function GET() {
  const csv = [
    "Title,First name,Surname,Gender,Phone,Email,Birthday,Marital status,Address,Area,Occupation,Department,Home cell,Stage,Joined on",
    "Bro.,Tunde,Adeyemi,Male,0803 123 4567,tunde@example.com,12/03/1990,Married,12 Allen Avenue Ikeja,Ikeja,Engineer,Choir,Ikeja Cell,Member,05/01/2019",
    "Sis.,Ngozi,Okafor,Female,0809 765 4321,,25 Dec,Single,,Yaba,Student,Ushering,,First timer,",
  ].join("\r\n");
  return new Response("﻿" + csv + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="build-my-church-members-template.csv"',
    },
  });
}
